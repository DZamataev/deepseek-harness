/**
 * Experimental composer prediction: after each completed turn, the Session's
 * own model guesses the user's next message from the warm prefix cache, and the
 * accepted guess is published as the `composerPrediction` projection.
 *
 * @module @deepseek-ai/dsh-experimental-composer-prediction
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { PredictionConfig } from './plan.ts'
import { composerPredictionProjection } from './projection.ts'
import { startPredictions } from './runner.ts'

export type {
  ComposerPredictionState,
  ComposerPredictionView,
  PredictionOutcome,
  PredictionRequestRecord,
  PredictionResultRecord,
} from './types.ts'

/** Plugin name. */
export const name = 'composer-prediction'
/** Required services. */
export const inject = ['llm', 'agents', 'sessionProjections']

/** Prediction bounds, all required. */
export interface Config extends PredictionConfig {}

/** Validated configuration; the bundle patch supplies every value. */
export const Config: z<Config> = z.object({
  maxOutputTokens: z.natural().min(1).required().description('Output-token cap of one prediction request, reasoning included.'),
  timeoutMs: z.natural().min(1).required().description('End-to-end deadline of one prediction request in milliseconds.'),
  minAssistantMessages: z.natural().min(1).required().description('Assistant replies required before the first prediction.'),
  maxUncachedTokens: z.natural().required().description('Largest estimated full-price input a prediction may replay.'),
})

/**
 * Register the projection unit and the post-turn scheduler.
 * @param ctx - plugin context.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.sessionProjections.register(composerPredictionProjection)
  startPredictions(ctx, config)
}
