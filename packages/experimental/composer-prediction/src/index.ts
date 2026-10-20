/**
 * Experimental composer prediction: the acceptance rules for a predicted next user message and the
 * Session records and projection value the Client reads. The request plan and the runner that
 * produce a prediction arrive with their own modules.
 *
 * @module @deepseek-ai/dsh-experimental-composer-prediction
 */

export type {
  ComposerPredictionState,
  ComposerPredictionView,
  PredictionOutcome,
  PredictionRequestRecord,
  PredictionResultRecord,
} from './types.ts'
export type { CleanResult, RejectReason } from './filter.ts'
export { cleanPrediction, MAX_PREDICTION_CHARS, MAX_PREDICTION_WORDS, rejectReason } from './filter.ts'
