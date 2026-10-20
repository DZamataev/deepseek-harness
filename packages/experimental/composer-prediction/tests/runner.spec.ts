/** Runner behavior: one prediction per completed turn, its records, and its projection. */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies, provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createAssistantMessage, createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf, Session, SessionId, type PluginRecord } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { maxTokensResponse, MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as ComposerPrediction from '../src/index.ts'
import { PREDICTION_INSTRUCTION } from '../src/instruction.ts'
import { REQUEST_RECORD, RESULT_RECORD } from '../src/projection.ts'

const CONFIG: ComposerPrediction.Config = {
  maxOutputTokens: 1024,
  timeoutMs: 60_000,
  minAssistantMessages: 2,
  maxUncachedTokens: 10_000,
}

/** Entries accepted by the shared mock adapter. */
type Script = ConstructorParameters<typeof MockAdapter>[0]

/** A model reply with a reasoning block before the text. */
function reasoningThenText(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'considering' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'considering' } },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text },
    { type: 'block-end', index: 1, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** A model reply that reports no token usage. */
function withoutUsage(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

/** A real agent with the plugin mounted over the mock route. */
async function harness(
  script: Script,
  config: Partial<ComposerPrediction.Config> = {},
  beforePlugin?: (ctx: Context) => void,
) {
  const ctx = new Context()
  contexts.push(ctx)
  provideWorkingDirectoryFixture(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const loop = await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  beforePlugin?.(ctx)
  const fiber = await ctx.plugin(ComposerPrediction, {
    maxOutputTokens: config.maxOutputTokens ?? CONFIG.maxOutputTokens,
    timeoutMs: config.timeoutMs ?? CONFIG.timeoutMs,
    minAssistantMessages: config.minAssistantMessages ?? CONFIG.minAssistantMessages,
    maxUncachedTokens: config.maxUncachedTokens ?? CONFIG.maxUncachedTokens,
  })
  const agent = await ctx.agentLoop.create(SessionId('runner'), { provider: 'mock', model: 'mock' })
  return { ctx, agent, adapter, fiber, loop }
}

/** A context with the plugin mounted but no agent, for Session-only events. */
async function mountedContext() {
  const ctx = new Context()
  contexts.push(ctx)
  provideWorkingDirectoryFixture(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
  const fiber = await ctx.plugin(ComposerPrediction, CONFIG)
  return { ctx, fiber }
}

/** Send `count` user messages, waiting for each turn to close. */
async function turns(agent: Agent, count = 1): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: `ask ${index}` }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
  }
}

/** Poll `predicate` until true or the deadline passes. */
async function waitFor(predicate: () => boolean, timeout = 5000, interval = 10): Promise<void> {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met before deadline')
    await new Promise(resolve => setTimeout(resolve, interval))
  }
}

/** Give queued microtasks and record appends a turn to settle. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 25))
}

/** Committed records of one plugin type in a log, in order. */
function recordsIn(session: Session, type: string): PluginRecord[] {
  return session.snapshotEvents().flatMap((event) => {
    const record = pluginRecordOf(event)
    return record?.type === type ? [record] : []
  })
}

/** Committed records of one plugin type on the agent's Session. */
function records(agent: Agent, type: string): PluginRecord[] {
  return recordsIn(agent.session, type)
}

/** The last committed `turn/end` of the agent's Session. */
function lastTurnEnd(agent: Agent): { turn: number; seq: number } {
  const end = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
  if (end === undefined) throw new Error('the fixture committed no turn/end')
  return { turn: end.data.turn, seq: end.seq }
}

/** Wait until the prediction of one completed exchange is fully recorded. */
async function accepted(agent: Agent): Promise<{ request: PluginRecord; result: PluginRecord }> {
  await waitFor(() => records(agent, RESULT_RECORD).length === 1)
  const request = records(agent, REQUEST_RECORD)[0]
  const result = records(agent, RESULT_RECORD)[0]
  if (request === undefined || result === undefined) throw new Error('the prediction was not recorded')
  return { request, result }
}

describe('composer prediction runner', () => {
  it('replays the completed turn and records one accepted request and result', async () => {
    const { ctx, agent, adapter } = await harness([
      textResponse('one'),
      textResponse('two'),
      textResponse('run the tests'),
    ])
    await turns(agent, 2)
    const end = lastTurnEnd(agent)
    const { request, result } = await accepted(agent)

    expect(records(agent, REQUEST_RECORD)).toHaveLength(1)
    expect(request.data).toMatchObject({
      turn: end.turn,
      throughSeq: end.seq,
      provider: 'mock',
      model: 'mock',
      maxTokens: 1024,
      instruction: PREDICTION_INSTRUCTION,
    })
    expect(result.data).toMatchObject({
      requestSeq: request.seq,
      turn: end.turn,
      outcome: 'accepted',
      text: 'run the tests',
    })
    expect(ctx.sessionProjections.stateOf(agent.session, 'composerPrediction')?.prediction)
      .toEqual({ turn: end.turn, text: 'run the tests' })

    const prediction = adapter.requests[2]
    const replayed = adapter.requests[1]
    if (prediction === undefined || replayed === undefined) throw new Error('the prediction call is missing')
    expect(prediction.purpose).toBe('composer-prediction')
    expect(prediction.maxTokens).toBe(1024)
    expect(prediction.tools).toEqual(replayed.tools)
    expect(prediction.messages.slice(0, replayed.messages.length)).toEqual(replayed.messages)
    expect(prediction.messages).toHaveLength(replayed.messages.length + 2)
    expect(prediction.messages[replayed.messages.length]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'two' }],
    })
    expect(prediction.messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'text', text: PREDICTION_INSTRUCTION }],
    })
  })

  it('clears the accepted prediction when the next turn starts', async () => {
    const { ctx, agent } = await harness([
      textResponse('one'),
      textResponse('two'),
      textResponse('run the tests'),
      textResponse('three'),
      textResponse('NONE'),
    ])
    await turns(agent, 2)
    await accepted(agent)
    const acceptedTurn = lastTurnEnd(agent).turn
    expect(ctx.sessionProjections.stateOf(agent.session, 'composerPrediction')?.prediction)
      .toEqual({ turn: acceptedTurn, text: 'run the tests' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'keep going' }], source: { kind: 'user' } }))
    await waitFor(() => agent.session.snapshotEvents()
      .some(event => event.type === 'turn/start' && event.data.turn === acceptedTurn + 1))

    expect(ctx.sessionProjections.stateOf(agent.session, 'composerPrediction')?.prediction).toBeNull()
    await agent.whenIdle()
    await waitFor(() => records(agent, RESULT_RECORD).length === 2)
    expect(ctx.sessionProjections.stateOf(agent.session, 'composerPrediction')?.prediction).toBeNull()
  })

  it('records an abstained result for a silent prediction', async () => {
    const { ctx, agent } = await harness([textResponse('one'), textResponse('two'), textResponse('NONE')])
    await turns(agent, 2)
    const { result } = await accepted(agent)

    expect(result.data).toMatchObject({ outcome: 'abstained', text: null })
    expect(ctx.sessionProjections.stateOf(agent.session, 'composerPrediction')?.prediction).toBeNull()
  })

  it('records an evaluative prediction as rejected', async () => {
    const { agent } = await harness([textResponse('one'), textResponse('two'), textResponse('looks good')])
    await turns(agent, 2)
    const { result } = await accepted(agent)

    expect(result.data).toMatchObject({ outcome: 'rejected', text: null, reason: 'evaluative' })
  })

  it('aborts a hanging prediction when the next turn starts', async () => {
    const { ctx, agent, adapter } = await harness([
      textResponse('one'),
      textResponse('two'),
      'hang',
      textResponse('three'),
      textResponse('NONE'),
    ])
    await turns(agent, 2)
    await waitFor(() => records(agent, REQUEST_RECORD).length === 1)
    const aborted = records(agent, REQUEST_RECORD)[0]
    if (aborted === undefined) throw new Error('the prediction request is missing')

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go on' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    await waitFor(() => records(agent, RESULT_RECORD).length === 1)

    const supersededResult = records(agent, RESULT_RECORD)
      .some(record => (record.data as { requestSeq: number }).requestSeq === aborted.seq)
    expect(supersededResult).toBe(false)
    expect(adapter.requests).toHaveLength(5)
    expect(adapter.requests[3]?.purpose).toBeUndefined()
    expect(ctx.sessionProjections.stateOf(agent.session, 'composerPrediction')?.prediction).toBeNull()
  })

  it('drops a queued prediction when a follow-up arrives as the turn closes', async () => {
    const holder: { agent?: Agent } = {}
    let turnEnds = 0
    // Registered before the plugin, so this microtask queues the real follow-up ahead of the
    // plugin's prediction dispatch: the message enters the inbox as the turn closes.
    const mounted = await harness([textResponse('one'), textResponse('two')], {}, (ctx) => {
      ctx.on('session/event', (_session, event) => {
        if (event.type !== 'turn/end') return
        turnEnds += 1
        if (turnEnds !== 2) return
        const queuedAgent = holder.agent
        if (queuedAgent === undefined) return
        queueMicrotask(() => {
          queuedAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'next' }], source: { kind: 'user' } }))
        })
      })
    })
    holder.agent = mounted.agent
    await turns(mounted.agent, 2)
    await settle()

    expect(mounted.agent.session.snapshotEvents().some(event => event.type === 'agent/inbox/spliced')).toBe(true)
    expect(records(mounted.agent, REQUEST_RECORD)).toEqual([])
  })

  it('ignores a reasoning block when reading the prediction text', async () => {
    const { agent } = await harness([textResponse('one'), textResponse('two'), reasoningThenText('run the tests')])
    await turns(agent, 2)
    const { result } = await accepted(agent)

    expect(result.data).toMatchObject({ outcome: 'accepted', text: 'run the tests' })
  })

  it('does not predict after the first exchange', async () => {
    const { agent } = await harness([textResponse('one')])
    await turns(agent, 1)
    await settle()

    expect(records(agent, REQUEST_RECORD)).toEqual([])
  })

  it('does not predict a turn that ended in error', async () => {
    const { agent } = await harness([() => { throw new Error('model down') }])
    await turns(agent, 1)
    await settle()

    const end = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
    expect(end?.type === 'turn/end' && end.data.reason.kind).toBe('error')
    expect(records(agent, REQUEST_RECORD)).toEqual([])
  })

  it('does not predict without reported usage', async () => {
    const { agent } = await harness([withoutUsage('one'), withoutUsage('two')])
    await turns(agent, 2)
    await settle()

    expect(records(agent, REQUEST_RECORD)).toEqual([])
  })

  it('does not predict a turn/end published for a Session without its Agent', async () => {
    const { ctx } = await mountedContext()
    const session = ctx.sessions.create(SessionId('orphan'))
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'mock' } },
      reason: 'initial',
    })
    session.append('turn/start', { turn: 0 })
    session.append('turn/end', { turn: 0, reason: { kind: 'completed' } })
    await settle()

    expect(recordsIn(session, REQUEST_RECORD)).toEqual([])
  })

  it('ignores a turn/end published by a stale Session with the agent id', async () => {
    const { ctx, agent } = await harness([
      textResponse('one'),
      textResponse('two'),
      textResponse('run the tests'),
    ])
    await turns(agent, 2)
    await accepted(agent)
    const stale = Session.create(SessionId('runner'))
    const end = stale.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    ctx.emit('session/event', stale, end)
    await settle()

    expect(records(agent, REQUEST_RECORD)).toHaveLength(1)
  })

  it('removes the projection unit and stops predicting after plugin disposal (HMR)', async () => {
    const { ctx, agent, fiber } = await harness([textResponse('one'), textResponse('two')])
    await turns(agent, 1)
    await fiber.dispose()
    await turns(agent, 1)
    await settle()

    expect(records(agent, REQUEST_RECORD)).toEqual([])
    expect(ctx.sessionProjections.stateOf(agent.session, 'composerPrediction')).toBeUndefined()
  })

  it('aborts a hanging prediction on plugin disposal and records no result', async () => {
    const { agent, fiber } = await harness([textResponse('one'), textResponse('two'), 'hang'])
    await turns(agent, 2)
    await waitFor(() => records(agent, REQUEST_RECORD).length === 1)

    await fiber.dispose()
    await settle()

    expect(records(agent, REQUEST_RECORD)).toHaveLength(1)
    expect(records(agent, RESULT_RECORD)).toEqual([])
  })

  it('records a failed result when the prediction transport throws', async () => {
    const { ctx, agent } = await harness([textResponse('one'), textResponse('two')])
    ctx.on('llm/stream', (options, next) => {
      if (options.purpose === 'composer-prediction') throw new Error('blocked')
      return next()
    })
    await turns(agent, 2)
    const { result } = await accepted(agent)

    expect(result.data).toMatchObject({ outcome: 'failed', text: null, reason: 'Error' })
  })

  it('records a failed result with a stable reason for a non-Error throw', async () => {
    const { ctx, agent } = await harness([textResponse('one'), textResponse('two')])
    ctx.on('llm/stream', (options, next) => {
      if (options.purpose === 'composer-prediction') throw 'blocked'
      return next()
    })
    await turns(agent, 2)
    const { result } = await accepted(agent)

    expect(result.data).toMatchObject({ outcome: 'failed', text: null, reason: 'unknown' })
  })

  it('records an error finish as a failed result', async () => {
    const { agent } = await harness([textResponse('one'), textResponse('two'), () => { throw new Error('provider down') }])
    await turns(agent, 2)
    const { result } = await accepted(agent)

    expect(result.data).toMatchObject({ outcome: 'failed', text: null, reason: 'UNKNOWN' })
  })

  it('records a max-tokens finish as a failed result', async () => {
    const { agent } = await harness([textResponse('one'), textResponse('two'), maxTokensResponse('partial')])
    await turns(agent, 2)
    const { result } = await accepted(agent)

    expect(result.data).toMatchObject({ outcome: 'failed', text: null, reason: 'max-tokens' })
  })

  it('times out a hanging prediction and records the abort as a failed result', async () => {
    const { agent } = await harness([textResponse('one'), textResponse('two'), 'hang'], { timeoutMs: 5 })
    await turns(agent, 2)
    const { result } = await accepted(agent)

    expect(result.data).toMatchObject({ outcome: 'failed', text: null, reason: 'UNKNOWN' })
  })

  it('aborts an in-flight prediction when its Agent is disposed', async () => {
    const { agent, loop } = await harness([textResponse('one'), textResponse('two'), 'hang'])
    await turns(agent, 2)
    await waitFor(() => records(agent, REQUEST_RECORD).length === 1)

    await loop.dispose()
    await settle()

    expect(records(agent, REQUEST_RECORD)).toHaveLength(1)
    expect(records(agent, RESULT_RECORD)).toEqual([])
  })

  it('reads last-usage from the raw stream when the settled event has none', async () => {
    const { agent } = await harness([
      textResponse('one'),
      textResponse('two'),
      textResponse('run the tests'),
      textResponse('three'),
      textResponse('continue'),
    ])
    await turns(agent, 2)
    await accepted(agent)
    const { turn } = lastTurnEnd(agent)
    agent.session.append('assistant/message', {
      turn,
      step: 0,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'legacy' }],
        source: { provider: 'mock', model: 'mock' },
      }),
      stream: [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } } }],
    }, { surfaceOp: 'append' })

    await turns(agent, 1)
    await waitFor(() => records(agent, REQUEST_RECORD).length === 2)

    expect(records(agent, REQUEST_RECORD)[1]?.data).toMatchObject({ turn: turn + 1 })
  })
})
