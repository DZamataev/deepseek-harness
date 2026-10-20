/**
 * Composer suggestions: the one way another plugin offers placeholder text
 * that the empty composer can accept. The composer cannot import the plugin
 * that computes a suggestion, so a single provider registers here and the bar
 * reads its own Session's source. Sources subscribe to the provider only while
 * the composer listens, so a Session that is no longer shown holds nothing.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComposerSuggestionProvider, ComposerSuggestions } from '../contract/composer-suggestions.ts'

/** One Session's identity-stable view over the current provider's source. */
class SuggestionRelay implements ObservableSnapshot<string | undefined> {
  private source: ObservableSnapshot<string | undefined> | undefined
  private readonly listeners = new Set<() => void>()
  private release: (() => void) | undefined

  /** @param source - current provider source, or undefined without a provider. */
  attach(source: ObservableSnapshot<string | undefined> | undefined): void {
    if (source === this.source) return
    this.release?.()
    this.release = undefined
    this.source = source
    if (this.listeners.size > 0) this.release = source?.subscribe(this.notify)
    this.notify()
  }

  /** @returns the current suggestion text; blank text counts as none. */
  getSnapshot = (): string | undefined => {
    const text = this.source?.getSnapshot()?.trim()
    return text === undefined || text === '' ? undefined : text
  }

  /**
   * @param listener - change callback.
   * @returns unsubscribe; the last one releases the source subscription.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.release = this.source?.subscribe(this.notify)
    return () => {
      if (!this.listeners.delete(listener) || this.listeners.size > 0) return
      this.release?.()
      this.release = undefined
    }
  }

  private readonly notify = (): void => {
    for (const listener of [...this.listeners]) listener()
  }
}

/** The per-Session composer-suggestion registry (one instance per plugin fiber). */
export class ComposerSuggestionRegistry implements ComposerSuggestions {
  private registration: { readonly provider: ComposerSuggestionProvider } | undefined
  private readonly relays = new Map<SessionId, SuggestionRelay>()

  /** @inheritdoc */
  register(provider: ComposerSuggestionProvider): () => void {
    if (this.registration !== undefined) throw new Error('a composer suggestion provider is already registered')
    // A registration token, not the provider identity, scopes the disposer:
    // the same provider may be registered again after this one withdraws.
    const token = { provider }
    this.registration = token
    for (const [sessionId, relay] of this.relays) relay.attach(provider.forSession(sessionId))
    return () => {
      if (this.registration !== token) return
      this.registration = undefined
      for (const relay of this.relays.values()) relay.attach(undefined)
    }
  }

  /** @inheritdoc */
  storeFor(sessionId: SessionId): ObservableSnapshot<string | undefined> {
    let relay = this.relays.get(sessionId)
    if (relay === undefined) {
      relay = new SuggestionRelay()
      this.relays.set(sessionId, relay)
    }
    // Re-resolve on every inject: a replaced Session object gets a fresh source.
    relay.attach(this.registration?.provider.forSession(sessionId))
    return relay
  }
}
