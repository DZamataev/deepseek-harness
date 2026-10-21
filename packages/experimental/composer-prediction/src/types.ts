/**
 * Types for the experimental composer prediction: the Session records one request and one result,
 * and the projection publishes the latest accepted suggestion to the Client.
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm/types'
// Loads the projection outlet's tables so the declaration merges below land on them.
import type {} from '@deepseek-ai/dsh-session-projection/types'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

/** Why a completed prediction request produced no suggestion. */
export type PredictionOutcome = 'accepted' | 'abstained' | 'rejected' | 'failed'

/** Auxiliary request retained before dispatch. */
export interface PredictionRequestRecord {
  /** Turn the prediction was requested for. */
  readonly turn: number
  /** Seq of the `turn/end` whose surface was replayed. */
  readonly throughSeq: SessionSeq
  /** Provider route of the replayed request. */
  readonly provider: string
  /** Model route of the replayed request. */
  readonly model: string
  /** Output-token ceiling declared for the auxiliary request. */
  readonly maxTokens: number
  /** Exact instruction appended after the replayed conversation. */
  readonly instruction: string
}

/** Outcome retained after the reply; superseded requests have none. */
export interface PredictionResultRecord {
  /** Seq of the request record this outcome belongs to. */
  readonly requestSeq: SessionSeq
  /** Turn the prediction was requested for. */
  readonly turn: number
  /** Which of the four completions happened. */
  readonly outcome: PredictionOutcome
  /** Accepted suggestion text; null for every other outcome. */
  readonly text: string | null
  /** Stable reason for `rejected` (filter rule) or `failed` (finish kind or error code). */
  readonly reason?: string
  /** Token accounting of the auxiliary request, when the provider reported it. */
  readonly usage?: TokenUsage
}

/** Client-visible current suggestion for the Session's latest completed turn. */
export interface ComposerPredictionView {
  /** Turn whose completed surface the suggestion continues. */
  readonly turn: number
  /** Accepted suggestion text shown in the composer. */
  readonly text: string
}

/** Host fold state: the latest started turn and its suggestion. */
export interface ComposerPredictionState {
  /** Turn the fold has seen start; a newer turn clears the previous suggestion. */
  readonly startedTurn: number
  /** Latest accepted suggestion, or null when there is none. */
  readonly prediction: ComposerPredictionView | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Composer prediction request replayed from the Session's last routed request, retained before dispatch. */
    'plugin:composer-prediction/request': PredictionRequestRecord
    /** Composer prediction outcome for one request; absent when a newer turn superseded it. */
    'plugin:composer-prediction/result': PredictionResultRecord
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host fold state for the latest started turn and its accepted suggestion. */
    composerPrediction: ComposerPredictionState
  }
  interface SessionProjectionMap {
    /** The latest completed turn's accepted composer prediction, or null. */
    composerPrediction: ComposerPredictionView | null
  }
}
