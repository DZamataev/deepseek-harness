import { describe, expect, it } from 'vitest'
import { cleanPrediction, rejectReason } from '../src/filter.ts'

describe('cleanPrediction', () => {
  it.each([
    ['run the tests', 'run the tests'],
    ['"commit this"', 'commit this'],
    ['USER: push it', 'push it'],
    ['Suggestion: run the linter', 'run the linter'],
    ['<suggestion>go ahead</suggestion>', 'go ahead'],
    ['да', 'да'],
    ['yes', 'yes'],
    ['/goal ship it', '/goal ship it'],
    ['запусти тесты', 'запусти тесты'],
    ['继续', '继续'],
  ])('accepts %j as %j', (raw, text) => {
    expect(cleanPrediction(raw)).toEqual({ kind: 'accepted', text })
  })

  it.each(['NONE', 'none.', '  ', ''])('abstains on %j', (raw) => {
    expect(cleanPrediction(raw)).toEqual({ kind: 'abstained' })
  })

  it.each([
    ['nothing to suggest', 'meta_text'],
    ['API Error: overloaded', 'error_message'],
    ['open [path to file]', 'placeholder'],
    ['Note: run it', 'prefixed_label'],
    ['tests', 'too_few_words'],
    ['please go ahead and run every single one of the remaining integration tests now', 'too_many_words'],
    ['Run the tests. Then commit.', 'multiple_sentences'],
    ['run **the** tests', 'has_formatting'],
    ['looks good to me', 'evaluative'],
    ['спасибо, отлично', 'evaluative'],
    ['Let me run the tests', 'assistant_voice'],
    ['Я сделаю это сейчас', 'assistant_voice'],
  ])('rejects %j with %s', (raw, reason) => {
    expect(cleanPrediction(raw)).toEqual({ kind: 'rejected', reason })
  })

  // Hermes' meta rule matches a bare "silence" wrapped in non-word characters, and it runs before
  // the bracketed-reply rule, so this verdict is meta_text rather than meta_wrapped.
  it('rejects "(silence)" with meta_text because the meta rule precedes the bracketed rule', () => {
    expect(cleanPrediction('(silence)')).toEqual({ kind: 'rejected', reason: 'meta_text' })
  })

  it('keeps ordinary code talk with brackets', () => {
    expect(rejectReason('fix a[10] in Promise<Result>')).toBeUndefined()
  })

  it('keeps a single bracketed word as code talk', () => {
    expect(rejectReason('run {name} now')).toBeUndefined()
  })

  it('rejects a parenthesized reply that announces nothing else', () => {
    expect(rejectReason('(continue)')).toBe('meta_wrapped')
  })

  it.each([
    'open <path to file>',
    'open {path to file}',
    'wait ……',
    'fill ____ here',
  ])('rejects %j with placeholder', (raw) => {
    expect(rejectReason(raw)).toBe('placeholder')
  })

  it('rejects text at exactly the character ceiling', () => {
    expect(rejectReason(`${'a '.repeat(5)}${'b'.repeat(90)}`)).toBe('too_long')
  })

  // Hermes measures the ceiling with Python's len(), which counts code points: each astral
  // character is one code point but two UTF-16 units.
  it('accepts 99 code points of astral text whose UTF-16 length exceeds the ceiling', () => {
    const text = `run ${'😀'.repeat(95)}`
    expect(Array.from(text).length).toBe(99)
    expect(text.length).toBe(194)
    expect(cleanPrediction(text)).toEqual({ kind: 'accepted', text })
  })

  it('rejects 100 code points of astral text with too_long', () => {
    const text = `run ${'😀'.repeat(96)}`
    expect(Array.from(text).length).toBe(100)
    expect(text.length).toBe(196)
    expect(cleanPrediction(text)).toEqual({ kind: 'rejected', reason: 'too_long' })
  })
})
