import { describe, expect, it } from 'vitest'
import { PREDICTION_INSTRUCTION } from '../src/instruction.ts'

describe('PREDICTION_INSTRUCTION', () => {
  it('frames the request as the app asking for the next user message, not a user turn', () => {
    expect(PREDICTION_INSTRUCTION.startsWith(
      '[Composer prediction request from the app, not a message from the user. Do not answer the user, continue the task, or call tools.]',
    )).toBe(true)
  })

  it('ends with the abstain sentinel instruction', () => {
    expect(PREDICTION_INSTRUCTION.endsWith('To stay silent, output exactly NONE.')).toBe(true)
  })
})
