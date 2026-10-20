/** Feeds the composer suggestion seam from the Host `composerPrediction` projection. */
import type { Context } from '@deepseek-ai/cordis'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
// Type-only: pulls the Conversation service's `suggestions` seam.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the Session Controller service whose projections carry the suggestion.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'

/** Projection key published by the Host composer-prediction plugin. */
const PROJECTION_KEY = 'composerPrediction'

/** Required services. */
export const inject = ['conversation', 'sessions']

/** Client value of the `composerPrediction` projection, narrowed at the wire boundary. */
interface PredictionView {
  readonly turn: number
  readonly text: string
}

/**
 * Validate one projection value crossing the Host/Client wire.
 * @param value - raw projection snapshot.
 * @returns whether the value is a usable prediction.
 */
function isPredictionView(value: unknown): value is PredictionView {
  if (typeof value !== 'object' || value === null) return false
  if (!('turn' in value) || !('text' in value)) return false
  const { turn, text } = value
  return typeof turn === 'number' && Number.isFinite(turn)
    && typeof text === 'string' && text.length > 0
}

/** Source for a Session without a live binding; shared so repeated requests keep one identity. */
const NO_SUGGESTION: ObservableSnapshot<string | undefined> = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

/**
 * Map one projection face to suggestion text, forwarding the face's subscription.
 * @param face - the Session's `composerPrediction` projection face.
 * @returns suggestion text source.
 */
function textOf(face: ObservableSnapshot<unknown>): ObservableSnapshot<string | undefined> {
  return {
    getSnapshot: () => {
      const value = face.getSnapshot()
      return isPredictionView(value) ? value.text : undefined
    },
    subscribe: listener => face.subscribe(listener),
  }
}

/**
 * Register the prediction-backed composer suggestion provider. Sources are
 * cached by projection face, so a Session keeps one source while its face
 * stands and a closed Session's face stays collectible with its binding.
 * @param ctx - client plugin context.
 */
export function apply(ctx: Context): void {
  // Face-keyed by design: a SessionId-keyed cache would outlive a replaced or
  // closed Session and retain its ProjectionValueStore for the page lifetime.
  const sources = new WeakMap<ObservableSnapshot<unknown>, ObservableSnapshot<string | undefined>>()
  ctx.effect(() => ctx.conversation.suggestions.register({
    forSession: (sessionId) => {
      const face = ctx.sessions.binding(sessionId)?.session.projections.faceOf(PROJECTION_KEY)
      if (face === undefined) return NO_SUGGESTION
      let source = sources.get(face)
      if (source === undefined) {
        source = textOf(face)
        sources.set(face, source)
      }
      return source
    },
  }), 'client-ui-composer-prediction: suggestions')
}
