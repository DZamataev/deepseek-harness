import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ComposerSuggestionRegistry } from '../src/client/input/suggestions.ts'

const A = SessionId('a')

/** Wraps a source and counts the subscriptions that are currently active. */
function counted(source: ObservableSnapshot<string | undefined>): {
  readonly store: ObservableSnapshot<string | undefined>
  readonly active: () => number
} {
  let active = 0
  return {
    active: () => active,
    store: {
      getSnapshot: () => source.getSnapshot(),
      subscribe: (listener) => {
        active += 1
        const off = source.subscribe(listener)
        return () => {
          active -= 1
          off()
        }
      },
    },
  }
}

describe('composer suggestion registry', () => {
  it('reports no suggestion without a provider', () => {
    const registry = new ComposerSuggestionRegistry()
    expect(registry.storeFor(A).getSnapshot()).toBeUndefined()
  })

  it('follows a provider registered after the store was resolved, and its withdrawal', () => {
    const registry = new ComposerSuggestionRegistry()
    const store = registry.storeFor(A)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const text = createSnapshotStore<string | undefined>('run the tests')
    const dispose = registry.register({ forSession: () => text })
    expect(store.getSnapshot()).toBe('run the tests')
    text.set('commit this')
    expect(store.getSnapshot()).toBe('commit this')
    dispose()
    expect(store.getSnapshot()).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
  })

  it('keeps one store identity per Session', () => {
    const registry = new ComposerSuggestionRegistry()
    expect(registry.storeFor(A)).toBe(registry.storeFor(A))
  })

  it('rejects a second provider and keeps the first', () => {
    const registry = new ComposerSuggestionRegistry()
    registry.register({ forSession: () => createSnapshotStore<string | undefined>('first') })
    expect(() => registry.register({ forSession: () => createSnapshotStore<string | undefined>('second') }))
      .toThrow(/already registered/)
    expect(registry.storeFor(A).getSnapshot()).toBe('first')
  })

  it('subscribes to its source only while a listener is attached', () => {
    const registry = new ComposerSuggestionRegistry()
    const source = counted(createSnapshotStore<string | undefined>('x'))
    registry.register({ forSession: () => source.store })
    const store = registry.storeFor(A)
    expect(source.active()).toBe(0)
    const off = store.subscribe(() => {})
    expect(source.active()).toBe(1)
    const second = store.subscribe(() => {})
    expect(source.active()).toBe(1)
    off()
    expect(source.active()).toBe(1)
    second()
    expect(source.active()).toBe(0)
  })

  it('a withdrawn provider disposer called twice does not remove a newer provider', () => {
    const registry = new ComposerSuggestionRegistry()
    const dispose = registry.register({ forSession: () => createSnapshotStore<string | undefined>('old') })
    dispose()
    registry.register({ forSession: () => createSnapshotStore<string | undefined>('new') })
    dispose()
    expect(registry.storeFor(A).getSnapshot()).toBe('new')
  })

  it('a stale disposer leaves a later registration of the same provider active', () => {
    const registry = new ComposerSuggestionRegistry()
    const provider = { forSession: () => createSnapshotStore<string | undefined>('same') }
    const dispose = registry.register(provider)
    dispose()
    registry.register(provider)
    dispose()
    expect(registry.storeFor(A).getSnapshot()).toBe('same')
  })
})
