/**
 * The send-or-skip decision and the frozen request for one completed turn. The
 * request reproduces the Session's last routed request — derived surface
 * messages, logged call configuration, tools, and tool history — so the
 * provider's warm prefix cache covers everything but the appended instruction.
 */

import type { GenerateOptions, RequestUserInput, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { PREDICTION_INSTRUCTION } from './instruction.ts'

/** Bounds of one prediction request. */
export interface PredictionConfig {
  /** Output-token cap of one prediction request, reasoning included. */
  readonly maxOutputTokens: number
  /** End-to-end deadline of one prediction request in milliseconds. */
  readonly timeoutMs: number
  /** Assistant replies required before the first prediction. */
  readonly minAssistantMessages: number
  /** Largest estimated full-price input a prediction may replay. */
  readonly maxUncachedTokens: number
}

/** Why a completed turn gets no prediction, named for the durable verdict. */
export type SkipReason = 'subagent' | 'no-route' | 'early-conversation' | 'not-final-reply' | 'usage-unknown' | 'cache-cold'

/** One completed turn's frozen request. */
export interface PredictionPlan {
  /** Turn whose `turn/end` closed the surface this request replays. */
  readonly turn: number
  /** Seq of that `turn/end`; a later turn or record supersedes the plan. */
  readonly throughSeq: SessionSeq
  /** Exactly what is sent, without the per-attempt cancellation signal. */
  readonly request: Omit<GenerateOptions, 'signal'>
}

/** The instruction as the request's final user input, with no durable identity or source. */
const INSTRUCTION: RequestUserInput = {
  role: 'user',
  content: [{ type: 'text', text: PREDICTION_INSTRUCTION }],
}

/**
 * Estimate the input a replay pays at full price, from the previous reply's usage.
 * An automatic prefix cache retains the whole prior request, so only its reply
 * is new input; a request that read nothing from cache means the provider is not
 * caching at all, and the whole prompt is paid again.
 * @param usage - last assistant message usage.
 * @returns estimated input tokens a replay pays at full price.
 */
export function uncachedEstimate(usage: TokenUsage): number {
  return (usage.cacheReadTokens ?? 0) > 0 ? usage.outputTokens : usage.inputTokens + usage.outputTokens
}

/**
 * Decide whether the completed turn gets a prediction and freeze its exact request.
 * @param session - Session whose `turn/end` just committed.
 * @param end - the committed `turn/end` event.
 * @param lastUsage - usage of the turn's last assistant message, when reported.
 * @param config - resolved plugin configuration.
 * @returns the frozen request, or why none is sent.
 */
export function planPrediction(
  session: Session,
  end: SessionEvent<'turn/end'>,
  lastUsage: TokenUsage | undefined,
  config: PredictionConfig,
): { kind: 'send'; plan: PredictionPlan } | { kind: 'skip'; reason: SkipReason } {
  if (session.header.origin === 'subagent') return { kind: 'skip', reason: 'subagent' }
  const header = session.requestHeader()
  if (header === undefined) return { kind: 'skip', reason: 'no-route' }
  const messages = session.deriveMessages()
  const last = messages.at(-1)
  // An empty transcript or one ending on a tool call has no reply to continue.
  if (last?.role !== 'assistant' || last.content.some(block => block.type === 'tool-call')) {
    return { kind: 'skip', reason: 'not-final-reply' }
  }
  if (messages.filter(message => message.role === 'assistant').length < config.minAssistantMessages) {
    return { kind: 'skip', reason: 'early-conversation' }
  }
  if (lastUsage === undefined) return { kind: 'skip', reason: 'usage-unknown' }
  if (uncachedEstimate(lastUsage) > config.maxUncachedTokens) return { kind: 'skip', reason: 'cache-cold' }
  const request: Omit<GenerateOptions, 'signal'> = deepFreeze({
    ...header.config,
    maxTokens: config.maxOutputTokens,
    messages: [...messages, INSTRUCTION],
    toolHistory: session.toolHistory(),
    ...header.tools === undefined ? {} : { tools: header.tools },
    sessionId: session.id,
    purpose: 'composer-prediction',
  })
  return { kind: 'send', plan: { turn: end.data.turn, throughSeq: end.seq, request } }
}
