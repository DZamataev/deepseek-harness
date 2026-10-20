/** Fold behavior of the `composerPrediction` session projection over committed Session events. */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  appendPluginRecord,
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
  SessionLogOffset,
  SessionSeq,
} from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  composerPredictionProjection as unit,
  REQUEST_RECORD,
  RESULT_RECORD,
  resultRecordSchema,
} from '../src/projection.ts'
import type { ComposerPredictionState, PredictionResultRecord } from '../src/types.ts'

const HEADER: SessionHeader = {
  version: SESSION_FORMAT_VERSION,
  id: SessionId('composer-prediction'),
  createdAt: 0,
  isSeeded: false,
}

/** A detached Session whose committed log is the fold input. */
function commit(id: string): Session {
  return Session.create(SessionId(id))
}

/** Fold a committed log through the unit exactly as the projection registry drives it. */
function fold(events: readonly SessionEvent[]): ComposerPredictionState {
  return events.reduce(unit.apply, unit.init(HEADER, SessionLogOffset(0)))
}

/** One accepted outcome record for `turn`. */
function accepted(turn: number, text: string): PredictionResultRecord {
  return { requestSeq: SessionSeq(0), turn, outcome: 'accepted', text }
}

/** A user message as a turn or inbox event carries it. */
function userMessage(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

describe('composerPrediction projection', () => {
  it('shows the accepted result for the latest started turn', () => {
    const log = commit('accepted')
    log.append('turn/start', { turn: 1 })
    appendPluginRecord(log, RESULT_RECORD, accepted(1, 'run the tests'))

    expect(unit.wire.view(fold(log.snapshotEvents()))).toEqual({ turn: 1, text: 'run the tests' })
  })

  it.each<[string, (log: Session) => void]>([
    ['turn/start', (log) => { log.append('turn/start', { turn: 2 }) }],
    ['user/message', (log) => { log.append('user/message', userMessage('next'), { surfaceOp: 'append' }) }],
    ['agent/inbox/spliced', (log) => {
      log.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [userMessage('queued')] })
    }],
  ])('%s clears it', (_type, clear) => {
    const log = commit('clear')
    log.append('turn/start', { turn: 1 })
    appendPluginRecord(log, RESULT_RECORD, accepted(1, 'x y'))
    expect(unit.wire.view(fold(log.snapshotEvents()))).toEqual({ turn: 1, text: 'x y' })

    clear(log)
    expect(unit.wire.view(fold(log.snapshotEvents()))).toBeNull()
  })

  it('ignores a result for an older turn', () => {
    const log = commit('older-turn')
    log.append('turn/start', { turn: 1 })
    log.append('turn/start', { turn: 2 })
    appendPluginRecord(log, RESULT_RECORD, accepted(1, 'stale one'))

    expect(unit.wire.view(fold(log.snapshotEvents()))).toBeNull()
  })

  it('ignores non-accepted results and malformed records', () => {
    const log = commit('ignored')
    log.append('turn/start', { turn: 1 })
    appendPluginRecord(log, RESULT_RECORD, { requestSeq: SessionSeq(0), turn: 1, outcome: 'abstained', text: null })
    // @ts-expect-error -- a restored record can carry any JSON; the fold validates it.
    appendPluginRecord(log, RESULT_RECORD, { turn: 'x' })

    expect(unit.wire.view(fold(log.snapshotEvents()))).toBeNull()
  })

  it('returns the same state reference for unrelated events', () => {
    const log = commit('unrelated')
    log.append('turn/start', { turn: 1 })
    const state = fold(log.snapshotEvents())

    expect(unit.apply(state, log.append('step/end', { turn: 1, step: 0 }))).toBe(state)
  })

  it('an empty inbox splice does not clear it', () => {
    const log = commit('empty-splice')
    log.append('turn/start', { turn: 1 })
    appendPluginRecord(log, RESULT_RECORD, accepted(1, 'x y'))
    const state = fold(log.snapshotEvents())

    expect(unit.apply(state, log.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [] }))).toBe(state)
  })

  it('keeps the view reference stable while the accepted result stands', () => {
    const log = commit('stable-view')
    log.append('turn/start', { turn: 1 })
    appendPluginRecord(log, RESULT_RECORD, accepted(1, 'x y'))
    const state = fold(log.snapshotEvents())

    expect(unit.wire.view(state)).toBe(unit.wire.view(state))
    expect(unit.wire.viewSchema.parse(unit.wire.view(state))).toEqual({ turn: 1, text: 'x y' })
    expect(unit.stateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })

  it('clearing an already empty prediction keeps the state reference', () => {
    const log = commit('already-clear')
    log.append('turn/start', { turn: 1 })
    const state = fold(log.snapshotEvents())

    expect(unit.apply(state, log.append('user/message', userMessage('next'), { surfaceOp: 'append' }))).toBe(state)
  })

  it.each<[string, string | null]>([
    ['null', null],
    ['empty', ''],
  ])('ignores an accepted outcome whose text is %s', (_kind, text) => {
    const log = commit('accepted-without-text')
    log.append('turn/start', { turn: 1 })
    appendPluginRecord(log, RESULT_RECORD, { requestSeq: SessionSeq(0), turn: 1, outcome: 'accepted', text })

    expect(unit.wire.view(fold(log.snapshotEvents()))).toBeNull()
  })

  it('ignores the request record that precedes a result', () => {
    const log = commit('request-record')
    log.append('turn/start', { turn: 1 })
    appendPluginRecord(log, REQUEST_RECORD, {
      turn: 1,
      throughSeq: SessionSeq(0),
      provider: 'fixture',
      model: 'fixture',
      maxTokens: 32,
      instruction: 'predict the next message',
    })

    expect(unit.wire.view(fold(log.snapshotEvents()))).toBeNull()
  })

  it('accepts a result record carrying unrecognized fields such as usage', () => {
    const parsed = resultRecordSchema.parse({
      requestSeq: 0,
      turn: 1,
      outcome: 'accepted',
      text: 'run the tests',
      usage: { input: 12, output: 4 },
    })

    expect(parsed.usage).toEqual({ input: 12, output: 4 })
  })
})
