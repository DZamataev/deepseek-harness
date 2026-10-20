import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pluginRecordOf, type SessionEvent } from '@deepseek-ai/dsh-session'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { MAIN_REPLY_TEXT, type MockRequestRecord } from './fixtures/mock-llm.ts'
import { PREDICTION_INSTRUCTION } from '../src/instruction.ts'

const driver = fileURLToPath(new URL(
  './fixtures/driver.ts',
  import.meta.url,
))
const configPath = fileURLToPath(new URL(
  './fixtures/composer-prediction.patch.yml',
  import.meta.url,
))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** The request log the fixture adapter writes inside the isolated process cwd. */
const REQUEST_LOG = '.composer-prediction-requests.json'
/** The record that anchors one dispatched prediction. */
const REQUEST_RECORD = 'plugin:composer-prediction/request'
/** The record that carries one prediction's outcome. */
const RESULT_RECORD = 'plugin:composer-prediction/result'

async function jsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

/** Events of one plugin record type, in log order. */
function recordEvents(events: readonly SessionEvent[], type: string): SessionEvent[] {
  return events.filter(event => pluginRecordOf(event)?.type === type)
}

describe('composer prediction through the production headless profile', () => {
  it('records one accepted prediction after the second completed turn', async () => {
    let events: SessionEvent[] = []
    let requests: MockRequestRecord[] = []
    const { stderr } = await runLoaderSmoke({
      label: 'composer prediction',
      tempDirPrefix: 'composer-prediction-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      env: { COMPOSER_PREDICTION_LOG: REQUEST_LOG },
      inspect: async (cwd) => {
        const logs = await jsonlFiles(join(cwd, '.sessions'))
        expect(logs).toHaveLength(1)
        const lines = (await readFile(logs[0] as string, 'utf8')).trimEnd().split('\n')
        events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
        requests = JSON.parse(await readFile(join(cwd, REQUEST_LOG), 'utf8')) as MockRequestRecord[]
      },
    })
    expect(stderr).not.toContain('UNHANDLED')

    const requestEvents = recordEvents(events, REQUEST_RECORD)
    const resultEvents = recordEvents(events, RESULT_RECORD)
    expect(requestEvents).toHaveLength(1)
    expect(resultEvents).toHaveLength(1)
    expect(requestEvents[0]!.ignorable).toBe(true)
    expect(resultEvents[0]!.ignorable).toBe(true)

    const mainRequests = requests.filter(request => request.purpose === null)
    expect(mainRequests).toHaveLength(2)
    const secondMain = mainRequests[1]!
    const predictionRequests = requests.filter(request => request.purpose === 'composer-prediction')
    expect(predictionRequests).toHaveLength(1)
    const prediction = predictionRequests[0]!

    // The replay carries the second main request's conversation verbatim, then
    // the assistant reply, then the prediction instruction.
    expect(prediction.provider).toBe(secondMain.provider)
    expect(prediction.model).toBe(secondMain.model)
    expect(prediction.messageCount).toBe(secondMain.messageCount + 2)
    expect(prediction.messages.slice(0, secondMain.messages.length)).toEqual(secondMain.messages)
    const replayedReply = prediction.messages[secondMain.messages.length]!
    expect(replayedReply.role).toBe('assistant')
    expect(replayedReply.content).toEqual([{ type: 'text', text: MAIN_REPLY_TEXT }])
    const instruction = prediction.messages.at(-1)!
    expect(instruction.role).toBe('user')
    expect(instruction.content).toEqual([{ type: 'text', text: PREDICTION_INSTRUCTION }])

    expect(pluginRecordOf(requestEvents[0]!)?.data).toMatchObject({
      turn: 2,
      provider: secondMain.provider,
      model: secondMain.model,
      maxTokens: 1024,
    })
    expect(pluginRecordOf(resultEvents[0]!)?.data).toMatchObject({
      outcome: 'accepted',
      text: 'run the tests',
    })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
