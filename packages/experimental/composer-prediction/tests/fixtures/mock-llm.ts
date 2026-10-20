/** Deterministic two-response adapter for the composer-prediction Loader fixture. */

import { writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type StreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm'

/** One request the fixture adapter observed, for post-run assertions. */
export interface MockRequestRecord {
  /** Attribution of the request; null for an ordinary agent-loop request. */
  readonly purpose: string | null
  /** Routed provider. */
  readonly provider: string
  /** Routed model. */
  readonly model: string
  /** Number of conversation messages the provider received. */
  readonly messageCount: number
}

/** The suggestion the fake model returns for a composer-prediction request. */
const PREDICTION_TEXT = 'run the tests'
/** Usage of the prediction request: a warm cache read makes the estimate fit any limit. */
const PREDICTION_USAGE: TokenUsage = { inputTokens: 5, outputTokens: 3, cacheReadTokens: 100 }
/** The reply every other request receives. */
const MAIN_TEXT = 'done'
/** Usage of a main request; a cache read keeps the planner's estimate at the reply size. */
const MAIN_USAGE: TokenUsage = { inputTokens: 10, outputTokens: 1, cacheReadTokens: 50 }

class ComposerPredictionMockAdapter extends LlmAdapter {
  readonly #logPath: string
  readonly #requests: MockRequestRecord[] = []
  /** Serializes log replacements so concurrent requests cannot drop an entry. */
  #writing: Promise<void> = Promise.resolve()

  constructor(logPath: string) {
    super()
    this.#logPath = logPath
  }

  /** Record one request and write the complete log to disk. */
  async #record(options: GenerateOptions): Promise<void> {
    this.#requests.push({
      purpose: options.purpose ?? null,
      provider: options.provider,
      model: options.model,
      messageCount: options.messages.length,
    })
    const snapshot = JSON.stringify(this.#requests, null, 2)
    this.#writing = this.#writing.then(() => writeFile(this.#logPath, snapshot))
    await this.#writing
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    await this.#record(options)
    const prediction = options.purpose === 'composer-prediction'
    const text = prediction ? PREDICTION_TEXT : MAIN_TEXT
    const usage = prediction ? PREDICTION_USAGE : MAIN_USAGE
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'composer-prediction-mock-llm'
export const inject = ['llm']

/** Register the test-only `composer-prediction-mock` adapter. */
export function apply(ctx: Context): void {
  const logPath = process.env['COMPOSER_PREDICTION_LOG']
  if (logPath === undefined || logPath === '') {
    throw new Error('composer-prediction-mock-llm: COMPOSER_PREDICTION_LOG must name the request log file')
  }
  ctx.llm.registerAdapter(['composer-prediction-mock'], new ComposerPredictionMockAdapter(logPath))
}
