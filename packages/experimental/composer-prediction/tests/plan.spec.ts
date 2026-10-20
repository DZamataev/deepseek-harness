/** Plan behavior: the send-or-skip decision and the frozen replay request for one completed turn. */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies, provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { PREDICTION_INSTRUCTION } from '../src/instruction.ts'
import { planPrediction, uncachedEstimate, type PredictionConfig } from '../src/plan.ts'

const CONFIG: PredictionConfig = {
  maxOutputTokens: 1024,
  timeoutMs: 60_000,
  minAssistantMessages: 2,
  maxUncachedTokens: 10_000,
}

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

/** A context with the real loop prerequisites mounted. */
async function storeContext(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  provideWorkingDirectoryFixture(ctx)
  await mountAgentLoopTestDependencies(ctx)
  return ctx
}

/** Entries accepted by the shared mock adapter. */
type Script = ConstructorParameters<typeof MockAdapter>[0]

/** A real agent over the mock route, with scripted replies in call order. */
async function agentWith(script: Script, withTool = false): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = await storeContext()
  await ctx.plugin(AgentLoop, { agents: [] })
  if (withTool) {
    ctx.tools.register(defineContentToolFixture({
      name: 'finish',
      description: 'finish the turn',
      parameters: {},
      async execute(_args, exec) {
        exec.concludeTurn()
        return [{ type: 'text', text: 'done' }]
      },
    }))
  }
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  const agent = await ctx.agentLoop.create(SessionId('p1'), { provider: 'mock', model: 'mock' })
  return { ctx, agent }
}

/** Run `count` completed exchanges through the agent. */
async function exchange(agent: Agent, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: `ask ${index}` }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
  }
}

/** The last committed `turn/end` of the agent's Session. */
function lastTurnEnd(agent: Agent): SessionEvent<'turn/end'> {
  const end = agent.session.snapshotEvents()
    .findLast((event): event is SessionEvent<'turn/end'> => event.type === 'turn/end')
  if (end === undefined) throw new Error('the fixture committed no turn/end')
  return end
}

describe('planPrediction', () => {
  it('skips the first exchange', async () => {
    const { agent } = await agentWith([textResponse('one')])
    await exchange(agent, 1)

    expect(planPrediction(agent.session, lastTurnEnd(agent), { inputTokens: 10, outputTokens: 3 }, CONFIG))
      .toEqual({ kind: 'skip', reason: 'early-conversation' })
  })

  it('replays the last routed request and appends the instruction', async () => {
    const { agent } = await agentWith([textResponse('one'), textResponse('two')])
    await exchange(agent, 2)
    const end = lastTurnEnd(agent)

    const verdict = planPrediction(agent.session, end, { inputTokens: 10, outputTokens: 3, cacheReadTokens: 5 }, CONFIG)

    expect(verdict.kind).toBe('send')
    if (verdict.kind !== 'send') return
    const header = agent.session.requestHeader()
    if (header === undefined) throw new Error('the fixture committed no request/header')
    const derived = agent.session.deriveMessages()
    expect(verdict.plan.request.provider).toBe(header.config.provider)
    expect(verdict.plan.request.model).toBe(header.config.model)
    expect(verdict.plan.request.messages.slice(0, derived.length)).toEqual(derived)
    expect(verdict.plan.request.messages).toHaveLength(derived.length + 1)
    const instruction = verdict.plan.request.messages.at(-1)
    expect(instruction?.role).toBe('user')
    expect(instruction?.content).toEqual([{ type: 'text', text: PREDICTION_INSTRUCTION }])
    expect(verdict.plan.request.maxTokens).toBe(1024)
    expect(verdict.plan.request.purpose).toBe('composer-prediction')
    expect(verdict.plan.request.sessionId).toBe(agent.session.id)
    expect(verdict.plan.request.tools).toBeUndefined()
    expect(verdict.plan.turn).toBe(end.data.turn)
    expect(verdict.plan.throughSeq).toBe(end.seq)
  })

  it('skips a turn that ends on a tool call', async () => {
    const { agent } = await agentWith([textResponse('one'), toolCallResponse('call-1', 'finish', {})], true)
    await exchange(agent, 2)

    expect(planPrediction(agent.session, lastTurnEnd(agent), { inputTokens: 10, outputTokens: 3 }, CONFIG))
      .toEqual({ kind: 'skip', reason: 'not-final-reply' })
  })

  it('replays the logged tools and tool history', async () => {
    const { agent } = await agentWith([textResponse('one'), textResponse('two')], true)
    await exchange(agent, 2)

    const verdict = planPrediction(agent.session, lastTurnEnd(agent), { inputTokens: 10, outputTokens: 3 }, CONFIG)

    expect(verdict.kind).toBe('send')
    if (verdict.kind !== 'send') return
    const header = agent.session.requestHeader()
    if (header === undefined) throw new Error('the fixture committed no request/header')
    expect(verdict.plan.request.tools).toEqual(header.tools)
    expect(verdict.plan.request.toolHistory).toEqual(agent.session.toolHistory())
  })

  it('skips a cold cache', async () => {
    const { agent } = await agentWith([textResponse('one'), textResponse('two')])
    await exchange(agent, 2)

    expect(planPrediction(agent.session, lastTurnEnd(agent), { inputTokens: 20_000, outputTokens: 10 }, CONFIG))
      .toEqual({ kind: 'skip', reason: 'cache-cold' })
  })

  it('skips without usage', async () => {
    const { agent } = await agentWith([textResponse('one'), textResponse('two')])
    await exchange(agent, 2)

    expect(planPrediction(agent.session, lastTurnEnd(agent), undefined, CONFIG))
      .toEqual({ kind: 'skip', reason: 'usage-unknown' })
  })

  it('skips a Session without a routed request', async () => {
    const ctx = await storeContext()
    const session = ctx.sessions.create(SessionId('no-route'))
    const end = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    expect(planPrediction(session, end, { inputTokens: 10, outputTokens: 3 }, CONFIG))
      .toEqual({ kind: 'skip', reason: 'no-route' })
  })

  it('skips a subagent Session', async () => {
    const ctx = await storeContext()
    const session = ctx.sessions.create(SessionId('subagent'), { meta: { origin: 'subagent' } })
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'mock' } },
      reason: 'initial',
    })
    const end = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    expect(planPrediction(session, end, { inputTokens: 10, outputTokens: 3 }, CONFIG))
      .toEqual({ kind: 'skip', reason: 'subagent' })
  })
})

describe('uncachedEstimate', () => {
  it('counts only the reply once the provider reads from cache', () => {
    expect(uncachedEstimate({ inputTokens: 500, outputTokens: 40, cacheReadTokens: 9000 })).toBe(40)
  })

  it('counts the whole prompt when nothing was read from cache', () => {
    expect(uncachedEstimate({ inputTokens: 500, outputTokens: 40 })).toBe(540)
  })
})
