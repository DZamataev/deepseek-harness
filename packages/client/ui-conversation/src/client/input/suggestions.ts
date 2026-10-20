/**
 * Composer suggestions: the one way another plugin offers placeholder text
 * that the empty composer can accept. The composer cannot import the plugin
 * that computes a suggestion, so a single provider registers here and the bar
 * reads its own Session's source. Each Session gets one identity-stable relay;
 * a relay resolves the provider's current source on demand and holds it only
 * while the composer listens, so a Session that is no longer shown retains no
 * projection face.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComposerSuggestionProvider, ComposerSuggestions } from '../contract/composer-suggestions.ts'

/** One Session's identity-stable view over the current provider's source. */
class SuggestionRelay implements ObservableSnapshot<string | undefined> {
  private provider: ComposerSuggestionProvider | undefined
  /** The subscribed source; idle relays hold none and resolve one per read. */
  private source: ObservableSnapshot<string | undefined> | undefined
  private readonly listeners = new Set<() => void>()
  private release: (() => void) | undefined

  /** @param sessionId - Session this relay stands for. */
  constructor(private readonly sessionId: SessionId) {}

  /**
   * Point the relay at the current registration and re-resolve its source.
   * @param provider - the registered provider, or undefined without one.
   */
  attach(provider: ComposerSuggestionProvider | undefined): void {
    const changed = provider !== this.provider
    this.provider = provider
    // An idle relay keeps no source: the next read or subscription resolves it.
    if (this.listeners.size === 0) return
    const source = provider?.forSession(this.sessionId)
    if (source === this.source) {
      if (changed) this.notify()
      return
    }
    this.release?.()
    this.source = source
    this.release = source?.subscribe(this.notify)
    this.notify()
  }

  /** @returns the current suggestion text; blank text counts as none. */
  getSnapshot = (): string | undefined => {
    const text = (this.source ?? this.provider?.forSession(this.sessionId))?.getSnapshot()?.trim()
    return text === undefined || text === '' ? undefined : text
  }

  /**
   * @param listener - change callback.
   * @returns unsubscribe; the last one releases the source subscription.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) {
      this.source = this.provider?.forSession(this.sessionId)
      this.release = this.source?.subscribe(this.notify)
    }
    return () => {
      if (!this.listeners.delete(listener) || this.listeners.size > 0) return
      this.release?.()
      this.release = undefined
      this.source = undefined
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
    for (const relay of this.relays.values()) relay.attach(provider)
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
      relay = new SuggestionRelay(sessionId)
      this.relays.set(sessionId, relay)
    }
    // Re-resolve on every inject: a replaced Session object gets a fresh source.
    relay.attach(this.registration?.provider)
    return relay
  }
}
