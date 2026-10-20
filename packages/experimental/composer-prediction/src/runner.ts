/**
 * Post-turn prediction scheduling. One request per completed turn and Session;
 * a newer turn, an inbox insertion, Agent disposal, or plugin disposal aborts
 * it, and an aborted request records no result.
 */

import type { Context } from '@deepseek-ai/cordis'
import { appendPluginRecord, type Session, type SessionId, type SessionSeq } from '@deepseek-ai/dsh-session'
// Loads the Agent event declarations for `agent/inbox/inserted` and `agent/disposed`.
import type {} from '@deepseek-ai/dsh-agent'
import { BlockAssembler, lastAssistantStreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { cleanPrediction } from './filter.ts'
import { PREDICTION_INSTRUCTION } from './instruction.ts'
import { planPrediction, type PredictionConfig, type PredictionPlan } from './plan.ts'
import { REQUEST_RECORD, RESULT_RECORD } from './projection.ts'
import type { PredictionResultRecord } from './types.ts'

/**
 * Start scheduling predictions on this plugin fiber. A record append failure is
 * reported through `ctx.logger` and drops only that prediction.
 * @param ctx - plugin context providing `llm`, `agents`, and the `session/event` feed.
 * @param config - resolved configuration.
 */
export function startPredictions(ctx: Context, config: PredictionConfig): void {
  const inflight = new Map<SessionId, AbortController>()
  const lastUsage = new Map<SessionId, TokenUsage>()
  const cancel = (id: SessionId): void => {
    inflight.get(id)?.abort()
    inflight.delete(id)
  }
  ctx.effect(() => () => {
    for (const controller of inflight.values()) controller.abort()
    inflight.clear()
    lastUsage.clear()
  }, 'composer-prediction requests')
  ctx.on('agent/inbox/inserted', ({ agent }) => { cancel(agent.session.id) })
  ctx.on('agent/disposed', ({ agent }) => {
    cancel(agent.session.id)
    lastUsage.delete(agent.session.id)
  })
  ctx.on('session/event', (session, event) => {
    switch (event.type) {
      case 'turn/start':
        cancel(session.id)
        // Usage belongs to the turn that reported it: a turn that settles no assistant
        // message of its own must not plan with the previous turn's numbers.
        lastUsage.delete(session.id)
        return
      case 'assistant/message': {
        const usage = event.data.usage ?? lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
        if (usage === undefined) lastUsage.delete(session.id)
        else lastUsage.set(session.id, usage)
        return
      }
      case 'turn/end': {
        if (event.data.reason.kind !== 'completed') return
        const agent = ctx.agents.get(session.id)
        if (agent === undefined || agent.session !== session) return
        // Planned synchronously so the replay is exactly the surface this turn/end closed.
        const verdict = planPrediction(session, event, lastUsage.get(session.id), config)
        if (verdict.kind === 'skip') return
        cancel(session.id)
        const controller = new AbortController()
        inflight.set(session.id, controller)
        // A record cannot be appended while this event is still publishing.
        queueMicrotask(() => {
          void predict(ctx, session, verdict.plan, config, controller.signal).finally(() => {
            if (inflight.get(session.id) === controller) inflight.delete(session.id)
          })
        })
        return
      }
      default:
        return
    }
  })
}

/**
 * Send one planned prediction and record its outcome.
 * @param ctx - plugin context providing the LLM service.
 * @param session - Session that closed the replayed turn.
 * @param plan - frozen request and its turn.
 * @param config - resolved configuration.
 * @param superseded - aborts when a newer turn, insertion, or disposal replaces this request.
 */
async function predict(
  ctx: Context,
  session: Session,
  plan: PredictionPlan,
  config: PredictionConfig,
  superseded: AbortSignal,
): Promise<void> {
  if (aborted(superseded)) return
  let requestSeq: SessionSeq
  try {
    requestSeq = appendPluginRecord(session, REQUEST_RECORD, {
      turn: plan.turn,
      throughSeq: plan.throughSeq,
      provider: plan.request.provider,
      model: plan.request.model,
      maxTokens: config.maxOutputTokens,
      instruction: PREDICTION_INSTRUCTION,
    })
  } catch (error) {
    // Without its request record a result has no anchor, so this prediction stops here.
    reportRecordFailure(ctx, session, REQUEST_RECORD, error)
    return
  }
  const signal = AbortSignal.any([superseded, AbortSignal.timeout(config.timeoutMs)])
  const assembler = new BlockAssembler()
  let result: Omit<PredictionResultRecord, 'requestSeq' | 'turn'>
  try {
    for await (const chunk of ctx.llm.stream({ ...plan.request, signal })) assembler.push(chunk)
    result = verdictOf(assembler)
  } catch (error) {
    // A decorative request: every remaining transport failure is recorded as no suggestion.
    result = { outcome: 'failed', text: null, reason: error instanceof Error ? error.name : 'unknown' }
  }
  if (aborted(superseded)) return
  try {
    appendPluginRecord(session, RESULT_RECORD, { requestSeq, turn: plan.turn, ...result })
  } catch (error) {
    reportRecordFailure(ctx, session, RESULT_RECORD, error)
  }
}

/**
 * Report one record a Session refused, keeping the deferred prediction task total.
 * @param ctx - plugin context owning the log line.
 * @param session - Session whose log rejected the record.
 * @param type - rejected record type.
 * @param error - the append failure.
 */
function reportRecordFailure(ctx: Context, session: Session, type: string, error: unknown): void {
  ctx.logger.warn(`composer-prediction: dropped ${type} record for session "${session.id}": ${String(error)}`)
}

/**
 * Read a superseded signal through a call so a prior check does not narrow it.
 * @param signal - signal to inspect.
 * @returns whether the request has been superseded.
 */
function aborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/**
 * Interpret one assembled prediction stream.
 * @param assembler - assembler fed with every chunk of the attempt.
 * @returns the durable outcome without the request identity.
 */
function verdictOf(assembler: BlockAssembler): Omit<PredictionResultRecord, 'requestSeq' | 'turn'> {
  const usage = assembler.usage
  const withUsage = usage === undefined ? {} : { usage }
  const finish = assembler.finish
  switch (finish.kind) {
    case 'stop': {
      const text = assembler.blocks().flatMap(block => block.type === 'text' ? [block.text] : []).join('')
      const cleaned = cleanPrediction(text)
      switch (cleaned.kind) {
        case 'accepted': return { outcome: 'accepted', text: cleaned.text, ...withUsage }
        case 'abstained': return { outcome: 'abstained', text: null, ...withUsage }
        case 'rejected': return { outcome: 'rejected', text: null, reason: cleaned.reason, ...withUsage }
        /* v8 ignore next -- CleanResult is closed and every member is handled above. */
        default: return assertNever(cleaned, 'composer-prediction verdict')
      }
    }
    case 'error':
    case 'aborted':
      return { outcome: 'failed', text: null, reason: finish.failure.code, ...withUsage }
    default:
      // Merge-extensible finish kinds: tool calls, max-tokens, and future kinds are no suggestion.
      return { outcome: 'failed', text: null, reason: finish.kind, ...withUsage }
  }
}
