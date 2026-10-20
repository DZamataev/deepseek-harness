/** Feeds the composer suggestion seam from the Host `composerPrediction` projection. */
import type { Context } from '@deepseek-ai/cordis'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
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

/** One cached per-Session source and the face it was derived from. */
interface CachedSource {
  readonly face: ObservableSnapshot<unknown> | undefined
  readonly source: ObservableSnapshot<string | undefined>
}

/**
 * Register the prediction-backed composer suggestion provider. The registry
 * re-attaches on every inject, so a Session keeps one source until its face
 * changes and a replaced generation re-subscribes to the new one.
 * @param ctx - client plugin context.
 */
export function apply(ctx: Context): void {
  // Plugin-owned cache: module-level state would outlive this fiber and hold replaced faces.
  const cache = new Map<SessionId, CachedSource>()
  ctx.effect(() => {
    const withdraw = ctx.conversation.suggestions.register({
      forSession: (sessionId) => {
        const face = ctx.sessions.binding(sessionId)?.session.projections.faceOf(PROJECTION_KEY)
        const cached = cache.get(sessionId)
        if (cached !== undefined && cached.face === face) return cached.source
        const source = face === undefined ? NO_SUGGESTION : textOf(face)
        cache.set(sessionId, { face, source })
        return source
      },
    })
    return () => {
      withdraw()
      cache.clear()
    }
  }, 'client-ui-composer-prediction: suggestions')
}
