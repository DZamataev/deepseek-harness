/** Composer suggestion registry types: one provider, one observable text per Session. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One provider of composer suggestions, registered through `ctx.conversation.suggestions`. */
export interface ComposerSuggestionProvider {
  /**
   * Resolve one Session's suggestion source.
   * @param sessionId - Session whose composer asks.
   * @returns observable suggestion text; `undefined` means no suggestion.
   */
  forSession(sessionId: SessionId): ObservableSnapshot<string | undefined>
}

/** The registry face reached through `ctx.conversation.suggestions`. */
export interface ComposerSuggestions {
  /**
   * Register the single suggestion provider.
   * @param provider - provider resolving per-Session sources.
   * @returns idempotent disposer that withdraws this provider.
   * @throws Error when another provider is registered.
   */
  register(provider: ComposerSuggestionProvider): () => void
  /**
   * Observe one Session's current suggestion, following provider registration changes.
   * @param sessionId - Session to observe.
   * @returns identity-stable source for this Session.
   */
  storeFor(sessionId: SessionId): ObservableSnapshot<string | undefined>
}
