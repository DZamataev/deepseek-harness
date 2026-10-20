/** Session projection folding composer prediction records into the latest turn's suggestion. */

import { z } from 'zod'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
// Loads the Agent event declarations so `agent/inbox/spliced` narrows through the merged event map.
import type {} from '@deepseek-ai/dsh-agent/types'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ComposerPredictionState, ComposerPredictionView } from './types.ts'

/** Record name of a retained prediction request. */
export const REQUEST_RECORD = 'plugin:composer-prediction/request'
/** Record name of a retained prediction outcome. */
export const RESULT_RECORD = 'plugin:composer-prediction/result'

const viewSchema = z.object({ turn: z.number().int().nonnegative(), text: z.string().min(1) })

/**
 * Durable result payload accepted by the fold; anything else is skipped.
 * `text` is non-null only for an accepted outcome and must be usable suggestion
 * text, so a record whose text is empty cannot produce a view its own wire
 * schema rejects. Fields a later build wrote pass validation unexamined.
 */
export const resultRecordSchema = z.looseObject({
  requestSeq: z.number().int().nonnegative(),
  turn: z.number().int().nonnegative(),
  outcome: z.enum(['accepted', 'abstained', 'rejected', 'failed']),
  text: z.string().min(1).nullable(),
  reason: z.string().optional(),
})

/** State before any event: no turn has started and no suggestion exists. */
const EMPTY: ComposerPredictionState = { startedTurn: -1, prediction: null }

/**
 * Withdraw the current suggestion.
 * @param state - state to clear.
 * @returns the same state reference when it already shows no suggestion.
 */
function clear(state: ComposerPredictionState): ComposerPredictionState {
  return state.prediction === null ? state : { ...state, prediction: null }
}

/**
 * Fold one committed event into the projection state.
 * @param state - state covering all prior events.
 * @param event - the next committed Session event.
 * @returns the next state, or the same reference when the event does not concern this unit.
 */
function apply(state: ComposerPredictionState, event: SessionEvent): ComposerPredictionState {
  switch (event.type) {
    case 'turn/start':
      return { startedTurn: event.data.turn, prediction: null }
    case 'user/message':
      return clear(state)
    case 'agent/inbox/spliced':
      return event.data.inserted.length > 0 ? clear(state) : state
    default: {
      // Merge-extensible event map: every other type is either this unit's record or irrelevant.
      const record = pluginRecordOf(event)
      if (record?.type !== RESULT_RECORD) return state
      const parsed = resultRecordSchema.safeParse(record.data)
      if (!parsed.success || parsed.data.outcome !== 'accepted' || parsed.data.text === null) return state
      if (parsed.data.turn !== state.startedTurn) return state
      return { ...state, prediction: { turn: parsed.data.turn, text: parsed.data.text } }
    }
  }
}

/**
 * The `composerPrediction` unit registered on `ctx.sessionProjections`: a
 * suggestion is shown only for the turn that started last, and any newer turn,
 * user message, or non-empty inbox insertion withdraws it. The fold changes
 * state only for those events and for this package's own result record, so the
 * wire view reference stays stable while the suggestion stands.
 */
export const composerPredictionProjection = {
  key: 'composerPrediction',
  stateVersion: 1,
  stateSchema: z.object({ startedTurn: z.number().int(), prediction: viewSchema.nullable() }),
  init: (_header: SessionHeader, _inheritedEventCount: SessionLogOffset) => EMPTY,
  apply,
  wire: {
    viewSchema: viewSchema.nullable(),
    view: (state: ComposerPredictionState): ComposerPredictionView | null => state.prediction,
  },
} satisfies ProjectionDefinition<'composerPrediction', ComposerPredictionState>
