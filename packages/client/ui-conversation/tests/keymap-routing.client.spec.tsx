// @vitest-environment jsdom
/**
 * Keymap routing at the DOM boundary: synthetic keydowns on the
 * contenteditable reach the registered composer commands (the jsdom lane's
 * gesture entry, below the full component bench).
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from 'lexical'
import { registerPlainText } from '@lexical/plain-text'
import type { ComposerKeymapHandlers } from '../src/client/input/editor/keymap.ts'
import { registerComposerKeymap } from '../src/client/input/editor/keymap.ts'
import type { ComposerKeyboard } from '../src/client/contract/draft-editor.ts'
import { installDraftKeymap } from '../src/client/input/editor/view-binding.ts'

/** Mount one plain-text editor root with the same teardown every gesture spec needs. */
function mountEditor(namespace: string) {
  const editor = createEditor({ namespace, onError: (e) => { throw e } })
  const root = document.createElement('div')
  root.contentEditable = 'true'
  document.body.appendChild(root)
  onTestFinished(() => { editor.setRootElement(null); root.remove() })
  editor.setRootElement(root)
  onTestFinished(registerPlainText(editor))
  return { editor, root }
}

describe('keymap keydown routing', () => {
  it('clears composition presentation on root swaps and unregisters pending callbacks', async () => {
    const editor = createEditor({ namespace: 'composition-root', onError: (e) => { throw e } })
    const first = document.createElement('div')
    const second = document.createElement('div')
    document.body.append(first, second)
    onTestFinished(() => {
      editor.setRootElement(null)
      first.remove()
      second.remove()
    })
    editor.setRootElement(first)
    const unregister = registerComposerKeymap(editor, {
      arbitrate: () => 'pass', space: () => false, dismissPopup: () => {},
      canSubmit: () => false, submit: () => {}, intakeFiles: () => {}, pasteText: () => {},
      acceptSuggestion: () => false,
    })
    onTestFinished(unregister)
    fireEvent.compositionStart(first)
    expect(first.hasAttribute('data-composer-composing')).toBe(true)
    editor.setRootElement(second)
    expect(first.hasAttribute('data-composer-composing')).toBe(false)
    expect(second.hasAttribute('data-composer-composing')).toBe(false)
    fireEvent.compositionStart(first)
    expect(first.hasAttribute('data-composer-composing')).toBe(false)
    fireEvent.compositionStart(second)
    expect(second.hasAttribute('data-composer-composing')).toBe(true)
    fireEvent.compositionEnd(second, { data: '' })
    unregister()
    await Promise.resolve()
    expect(second.hasAttribute('data-composer-composing')).toBe(false)
    fireEvent.compositionStart(second)
    expect(second.hasAttribute('data-composer-composing')).toBe(false)
  })

  it('routes Enter to the keymap submit handler', () => {
    const editor = createEditor({ namespace: 'keymap-routing', onError: (e) => { throw e } })
    const root = document.createElement('div')
    root.contentEditable = 'true'
    document.body.appendChild(root)
    editor.setRootElement(root)
    registerPlainText(editor)
    const submit = vi.fn()
    registerComposerKeymap(editor, {
      arbitrate: () => 'pass',
      space: () => false,
      dismissPopup: () => {},
      canSubmit: () => true,
      submit,
      intakeFiles: () => {},
      pasteText: () => {},
      acceptSuggestion: () => false,
    })
    fireEvent.keyDown(root, { key: 'Enter' })
    expect(submit).toHaveBeenCalledWith(false)
    fireEvent.keyDown(root, { key: 'Enter', metaKey: true })
    expect(submit).toHaveBeenCalledWith(true)
  })

  it.each([
    { altKey: true },
    { altKey: true, metaKey: true },
    { altKey: true, ctrlKey: true },
    { ctrlKey: true, metaKey: true },
    { shiftKey: true, metaKey: true },
    { shiftKey: true, ctrlKey: true },
    { shiftKey: true, altKey: true },
  ])('leaves modified Enter %j available to application commands', async (modifiers) => {
    const editor = createEditor({ namespace: 'modified-enter', onError: (error) => { throw error } })
    const root = document.createElement('div')
    root.contentEditable = 'true'
    document.body.appendChild(root)
    onTestFinished(() => { editor.setRootElement(null); root.remove() })
    editor.setRootElement(root)
    onTestFinished(registerPlainText(editor))
    const submit = vi.fn()
    const arbitrate = vi.fn(() => 'pass' as const)
    onTestFinished(registerComposerKeymap(editor, {
      arbitrate, space: () => false, dismissPopup: () => {}, canSubmit: () => true,
      submit, intakeFiles: () => {}, pasteText: () => {}, acceptSuggestion: () => false,
    }))
    editor.update(() => {
      const paragraph = $createParagraphNode().append($createTextNode('unsent draft'))
      $getRoot().append(paragraph)
      paragraph.selectEnd()
    }, { discrete: true })
    const applicationKeydown = vi.fn()
    document.addEventListener('keydown', applicationKeydown)
    onTestFinished(() => { document.removeEventListener('keydown', applicationKeydown) })

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...modifiers })
    root.dispatchEvent(event)
    await Promise.resolve()

    expect(submit).not.toHaveBeenCalled()
    expect(arbitrate).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(applicationKeydown).toHaveBeenCalledOnce()
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('unsent draft')
  })

  it('routes Tab through arbitration and passes when unconsumed', () => {
    const editor = createEditor({ namespace: 'keymap-routing', onError: (e) => { throw e } })
    const root = document.createElement('div')
    root.contentEditable = 'true'
    document.body.appendChild(root)
    editor.setRootElement(root)
    registerPlainText(editor)
    const arbitrate = vi.fn<(key: string, composing: boolean) => 'consumed' | 'pick-highlighted' | 'pass'>()
      .mockReturnValueOnce('consumed')
      .mockReturnValueOnce('pick-highlighted')
      .mockReturnValue('pass')
    registerComposerKeymap(editor, {
      arbitrate,
      space: () => false,
      dismissPopup: () => {},
      canSubmit: () => true,
      submit: () => {},
      intakeFiles: () => {},
      pasteText: () => {},
      acceptSuggestion: () => false,
    })
    const consumed = fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })
    expect(arbitrate).toHaveBeenCalledWith('tab', false)
    expect(consumed).toBe(false) // consumed: preventDefault fired
    const picked = fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })
    expect(picked).toBe(false) // picked: the completion replaces native traversal
    const passed = fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })
    expect(passed).toBe(true) // pass: the browser keeps native focus traversal

    // Shift+Tab is the menu's exit key, never its settle key.
    fireEvent.keyDown(root, { key: 'Tab', keyCode: 9, shiftKey: true })
    expect(arbitrate).toHaveBeenLastCalledWith('tabBack', false)
  })
})

describe('composer suggestion acceptance', () => {
  function mountWith(
    accept: () => boolean,
    arbitrate: ComposerKeymapHandlers['arbitrate'] = () => 'pass',
  ) {
    const { editor, root } = mountEditor('keymap-suggestion')
    onTestFinished(registerComposerKeymap(editor, {
      arbitrate, space: () => false, dismissPopup: () => {}, canSubmit: () => true, submit: () => {},
      intakeFiles: () => {}, pasteText: () => {}, acceptSuggestion: accept,
    }))
    return { root, arbitrate }
  }

  it.each([['Tab', 9], ['ArrowRight', 39]])('plain %s accepts and consumes the key', (key, keyCode) => {
    const accept = vi.fn(() => true)
    const { root } = mountWith(accept)
    expect(fireEvent.keyDown(root, { key, keyCode })).toBe(false)
    expect(accept).toHaveBeenCalledOnce()
  })

  it.each([['Tab', 9], ['ArrowRight', 39]])('%s passes through when nothing is accepted', (key, keyCode) => {
    const { root } = mountWith(() => false)
    expect(fireEvent.keyDown(root, { key, keyCode })).toBe(true)
  })

  it('Shift+Tab and Shift+ArrowRight never accept', () => {
    const accept = vi.fn(() => true)
    const { root } = mountWith(accept)
    fireEvent.keyDown(root, { key: 'Tab', keyCode: 9, shiftKey: true })
    fireEvent.keyDown(root, { key: 'ArrowRight', keyCode: 39, shiftKey: true })
    expect(accept).not.toHaveBeenCalled()
  })

  it('an IME-composing key never accepts', () => {
    const accept = vi.fn(() => true)
    const { root } = mountWith(accept)
    fireEvent.keyDown(root, { key: 'Tab', keyCode: 229 })
    expect(accept).not.toHaveBeenCalled()
    fireEvent.keyDown(root, { key: 'ArrowRight', keyCode: 39, isComposing: true })
    expect(accept).not.toHaveBeenCalled()
  })

  it('an open menu consuming Tab wins over the suggestion', () => {
    const accept = vi.fn(() => true)
    const { root } = mountWith(accept, () => 'consumed')
    fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })
    expect(accept).not.toHaveBeenCalled()
  })

  it('Escape keeps its current behavior', () => {
    const accept = vi.fn(() => true)
    const { root } = mountWith(accept)
    fireEvent.keyDown(root, { key: 'Escape', keyCode: 27 })
    expect(accept).not.toHaveBeenCalled()
  })
})

describe('composer suggestion gate', () => {
  type DraftGate = Parameters<typeof installDraftKeymap>[2]['current']

  function mountGate(overrides: Partial<DraftGate> = {}) {
    const { editor, root } = mountEditor('keymap-gate')
    const accepted: string[] = []
    const gate: Parameters<typeof installDraftKeymap>[2] = {
      current: {
        locked: false, machineBusy: false, canSteerQueue: false, running: false, steeringAvailable: true,
        busyEnter: 'queue', intakeFiles: () => {}, uploadsPending: false, showToast: () => {},
        t: () => '', canAcceptDrop: true, suggestion: 'predicted text',
        acceptSuggestion: (text) => { accepted.push(text) },
        ...overrides,
      },
    }
    const keyboard: ComposerKeyboard = {
      snapshot: { draft: '', attachmentIds: [], draftRev: 0, phase: 'plain', occurrences: [], queue: [] },
      editor,
      submit: () => {}, steerQueue: () => {}, paste: () => {},
      caretSpan: () => ({ start: 0, end: 0 }),
      arbitrate: () => 'pass', space: () => false, dismissPopup: () => {},
      bindFilePicker: () => () => {},
    }
    onTestFinished(installDraftKeymap(editor, keyboard, gate))
    return { editor, root, accepted }
  }

  it('writes a visible suggestion into the empty draft and consumes the key', () => {
    const { root, accepted } = mountGate()
    expect(fireEvent.keyDown(root, { key: 'ArrowRight', keyCode: 39 })).toBe(false)
    expect(accepted).toEqual(['predicted text'])
  })

  it('refuses to overwrite a draft the live document still holds', () => {
    const { editor, root, accepted } = mountGate()
    editor.update(() => {
      $getRoot().append($createParagraphNode().append($createTextNode('typed')))
    }, { discrete: true })
    expect(fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })).toBe(true)
    expect(accepted).toEqual([])
  })

  it.each([
    ['no visible suggestion', { suggestion: undefined }],
    ['a locked composer', { locked: true }],
    ['a busy machine', { machineBusy: true }],
  ])('refuses with %s', (_reason, overrides) => {
    const { root, accepted } = mountGate(overrides)
    expect(fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })).toBe(true)
    expect(accepted).toEqual([])
  })
})
