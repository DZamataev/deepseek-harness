/** The composer suggestion provider fed by the Host `composerPrediction` projection. */
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ComposerSuggestionProvider, ComposerSuggestions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { apply as hostApply } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'

const A = SessionId('a')
const B = SessionId('b')
const MISSING = SessionId('missing')

/** The only projection surface the plugin reads, at the narrowest type. */
interface ProjectionsLike {
  faceOf(key: string): ObservableSnapshot<unknown>
}

/** The only Session surface the plugin reads. */
interface SessionLike {
  readonly projections: ProjectionsLike
}

/** One Session binding, narrowed to its projection face. */
interface BindingLike {
  readonly session: SessionLike
}

/**
 * `ctx.sessions` double holding one published face per Session. A replaced
 * Session is a new binding object, as a replaced Controller generation is.
 */
class SessionsDouble {
  private readonly bindings = new Map<SessionId, BindingLike>()

  /**
   * Publish one `composerPrediction` face for a Session.
   * @param sessionId - Session whose binding resolves the face.
   * @param face - current projection face.
   */
  set(sessionId: SessionId, face: ObservableSnapshot<unknown>): void {
    this.bindings.set(sessionId, {
      session: {
        projections: {
          faceOf: (key) => {
            if (key !== 'composerPrediction') throw new Error(`unexpected projection "${key}"`)
            return face
          },
        },
      },
    })
  }

  /**
   * Drop a Session's binding.
   * @param sessionId - Session to unbind.
   */
  clear(sessionId: SessionId): void {
    this.bindings.delete(sessionId)
  }

  /**
   * @param sessionId - Session to resolve.
   * @returns its binding, or undefined while the Session is not live.
   */
  binding(sessionId: SessionId): BindingLike | undefined {
    return this.bindings.get(sessionId)
  }
}

/** One Session's relay over the provider's current source, mirroring the product registry. */
class Relay implements ObservableSnapshot<string | undefined> {
  private provider: ComposerSuggestionProvider | undefined
  private source: ObservableSnapshot<string | undefined> | undefined
  private readonly listeners = new Set<() => void>()
  private release: (() => void) | undefined

  /** @param sessionId - Session this relay stands for. */
  constructor(private readonly sessionId: SessionId) {}

  /** @param provider - the registered provider, or undefined without one. */
  attach(provider: ComposerSuggestionProvider | undefined): void {
    const changed = provider !== this.provider
    this.provider = provider
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

  getSnapshot = (): string | undefined =>
    (this.source ?? this.provider?.forSession(this.sessionId))?.getSnapshot()

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

/**
 * Local `ComposerSuggestions` double: one provider, and one identity-stable
 * relay per Session that re-resolves the provider source on every request.
 */
class SuggestionsDouble implements ComposerSuggestions {
  private provider: ComposerSuggestionProvider | undefined
  private readonly relays = new Map<SessionId, Relay>()

  /** @returns the registered provider, or undefined while none is. */
  get current(): ComposerSuggestionProvider | undefined {
    return this.provider
  }

  register(provider: ComposerSuggestionProvider): () => void {
    if (this.provider !== undefined) throw new Error('a composer suggestion provider is already registered')
    this.provider = provider
    for (const relay of this.relays.values()) relay.attach(provider)
    return () => {
      if (this.provider !== provider) return
      this.provider = undefined
      for (const relay of this.relays.values()) relay.attach(undefined)
    }
  }

  storeFor(sessionId: SessionId): ObservableSnapshot<string | undefined> {
    let relay = this.relays.get(sessionId)
    if (relay === undefined) {
      relay = new Relay(sessionId)
      this.relays.set(sessionId, relay)
    }
    relay.attach(this.provider)
    return relay
  }
}

/** @returns a plugin context with the two services plus the test-owned double. */
function fixture() {
  const ctx = new Context()
  const registry = new SuggestionsDouble()
  const sessions = new SessionsDouble()
  ctx.reflect.provide('conversation', { suggestions: registry })
  ctx.reflect.provide('sessions', sessions)
  return { ctx, registry, sessions }
}

/**
 * @param registry - the double holding the plugin's registration.
 * @returns the registered provider.
 * @throws when the plugin registered none.
 */
function providerOf(registry: SuggestionsDouble): ComposerSuggestionProvider {
  const provider = registry.current
  if (provider === undefined) throw new Error('the plugin registered no suggestion provider')
  return provider
}

describe('composer prediction client plugin', () => {
  it('exposes the host marker and its injected services', () => {
    hostApply()
    expect(inject).toEqual(['conversation', 'sessions'])
  })

  it('maps the projection to suggestion text and follows the face', async () => {
    const { ctx, registry, sessions } = fixture()
    const projection = createSnapshotStore<unknown>(null)
    sessions.set(A, projection)
    await ctx.plugin({ inject, apply })
    const store = registry.storeFor(A)
    const seen: (string | undefined)[] = []
    const off = store.subscribe(() => { seen.push(store.getSnapshot()) })
    expect(store.getSnapshot()).toBeUndefined()

    projection.set({ turn: 2, text: 'run the tests' })
    expect(store.getSnapshot()).toBe('run the tests')

    projection.set(null)
    expect(store.getSnapshot()).toBeUndefined()

    projection.set({ turn: 3, text: 'commit this' })
    expect(store.getSnapshot()).toBe('commit this')
    expect(seen).toEqual(['run the tests', undefined, 'commit this'])
    off()
  })

  it.each<[string, unknown]>([
    ['null', null],
    ['a non-object', 'run the tests'],
    ['a missing text', { turn: 1 }],
    ['a missing turn', { text: 'run the tests' }],
    ['a non-numeric turn', { turn: '1', text: 'run the tests' }],
    ['a non-finite turn', { turn: Number.POSITIVE_INFINITY, text: 'run the tests' }],
    ['a non-string text', { turn: 1, text: 7 }],
    ['an empty text', { turn: 1, text: '' }],
  ])('reports no suggestion for %s', async (_label, value) => {
    const { ctx, registry, sessions } = fixture()
    const projection = createSnapshotStore<unknown>(value)
    sessions.set(A, projection)
    await ctx.plugin({ inject, apply })
    expect(registry.storeFor(A).getSnapshot()).toBeUndefined()
  })

  it('keeps one source identity per Session while the face stands', async () => {
    const { ctx, registry, sessions } = fixture()
    sessions.set(A, createSnapshotStore<unknown>({ turn: 1, text: 'ready' }))
    await ctx.plugin({ inject, apply })
    const provider = providerOf(registry)

    expect(provider.forSession(A)).toBe(provider.forSession(A))
    expect(provider.forSession(MISSING)).toBe(provider.forSession(MISSING))
  })

  it('replaces the source when the Session face changes and follows the binding', async () => {
    const { ctx, registry, sessions } = fixture()
    sessions.set(A, createSnapshotStore<unknown>({ turn: 1, text: 'first' }))
    await ctx.plugin({ inject, apply })
    const provider = providerOf(registry)
    const store = registry.storeFor(A)
    const seen: (string | undefined)[] = []
    const off = store.subscribe(() => { seen.push(store.getSnapshot()) })
    const before = provider.forSession(A)
    expect(before.getSnapshot()).toBe('first')

    const replacement = createSnapshotStore<unknown>({ turn: 2, text: 'second' })
    sessions.set(A, replacement)
    const after = provider.forSession(A)
    expect(after).not.toBe(before)
    expect(registry.storeFor(A).getSnapshot()).toBe('second')
    replacement.set({ turn: 3, text: 'third' })
    expect(store.getSnapshot()).toBe('third')

    sessions.clear(A)
    const gone = provider.forSession(A)
    expect(gone).not.toBe(after)
    expect(gone.getSnapshot()).toBeUndefined()
    expect(registry.storeFor(A).getSnapshot()).toBeUndefined()
    expect(seen).toEqual(['second', 'third', undefined])
    off()
  })

  it('starts suggesting when a Session binding appears', async () => {
    const { ctx, registry, sessions } = fixture()
    await ctx.plugin({ inject, apply })
    const provider = providerOf(registry)
    const absent = provider.forSession(A)
    expect(absent.getSnapshot()).toBeUndefined()
    expect(provider.forSession(A)).toBe(absent)

    sessions.set(A, createSnapshotStore<unknown>({ turn: 1, text: 'bound' }))
    const bound = provider.forSession(A)
    expect(bound).not.toBe(absent)
    expect(bound.getSnapshot()).toBe('bound')
    expect(registry.storeFor(A).getSnapshot()).toBe('bound')
  })

  it('keys the cache by projection face rather than by SessionId', async () => {
    const { ctx, registry, sessions } = fixture()
    const shared = createSnapshotStore<unknown>({ turn: 1, text: 'shared' })
    sessions.set(A, shared)
    sessions.set(B, shared)
    await ctx.plugin({ inject, apply })
    const provider = providerOf(registry)

    // One face identifies one mapped source even across Session ids.
    expect(provider.forSession(A)).toBe(provider.forSession(B))
    const replacement = createSnapshotStore<unknown>({ turn: 2, text: 'replacement' })
    sessions.set(A, replacement)
    expect(provider.forSession(A)).not.toBe(provider.forSession(B))
  })

  it('returns the absent source once a closed Session\'s binding is gone', async () => {
    const { ctx, registry, sessions } = fixture()
    sessions.set(A, createSnapshotStore<unknown>({ turn: 1, text: 'now' }))
    await ctx.plugin({ inject, apply })
    const provider = providerOf(registry)
    expect(provider.forSession(A).getSnapshot()).toBe('now')

    sessions.clear(A)
    const absent = provider.forSession(A)
    expect(absent).toBe(provider.forSession(MISSING))
    expect(absent.getSnapshot()).toBeUndefined()
    // A later Session object resolves its own face instead of reusing the dropped one.
    sessions.set(A, createSnapshotStore<unknown>({ turn: 2, text: 'again' }))
    expect(provider.forSession(A)).not.toBe(absent)
    expect(provider.forSession(A).getSnapshot()).toBe('again')
    expect(registry.storeFor(A).getSnapshot()).toBe('again')
  })

  it('reports nothing for a Session without a binding', async () => {
    const { ctx, registry, sessions } = fixture()
    await ctx.plugin({ inject, apply })
    sessions.set(A, createSnapshotStore<unknown>({ turn: 1, text: 'ready' }))
    const store = registry.storeFor(MISSING)
    const off = store.subscribe(() => {})
    expect(store.getSnapshot()).toBeUndefined()
    off()
  })

  it('withdraws the registration and its sources when the plugin fiber disposes', async () => {
    const { ctx, registry, sessions } = fixture()
    const projection = createSnapshotStore<unknown>({ turn: 1, text: 'now' })
    sessions.set(A, projection)
    const fiber = ctx.plugin({ inject, apply })
    await fiber
    const store = registry.storeFor(A)
    const seen: (string | undefined)[] = []
    const off = store.subscribe(() => { seen.push(store.getSnapshot()) })
    expect(store.getSnapshot()).toBe('now')

    projection.set({ turn: 2, text: 'then' })
    expect(store.getSnapshot()).toBe('then')

    await fiber.dispose()
    expect(registry.current).toBeUndefined()
    expect(store.getSnapshot()).toBeUndefined()
    expect(registry.storeFor(A).getSnapshot()).toBeUndefined()
    expect(seen).toEqual(['then', undefined])
    off()
  })
})
