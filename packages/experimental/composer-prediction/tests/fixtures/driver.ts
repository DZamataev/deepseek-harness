#!/usr/bin/env node
/** Test driver that runs two turns through the headless Loader composition and waits for the post-turn prediction. */

import { setTimeout as delay } from 'node:timers/promises'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { pluginRecordOf, SessionId, type Session } from '@deepseek-ai/dsh-session'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** Deadline for the asynchronous prediction of the second completed turn. */
const PREDICTION_DEADLINE_MS = 10_000
/** Polling interval while the prediction is in flight. */
const PREDICTION_POLL_MS = 10
/** The record that proves the post-turn prediction settled. */
const RESULT_RECORD = 'plugin:composer-prediction/result'

/** Whether the Session committed a composer-prediction result. */
function predicted(session: Session): boolean {
  return session.ownEvents().some(event => pluginRecordOf(event)?.type === RESULT_RECORD)
}

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('composer-prediction driver requires a config path')

const ctx = await bootProductionProfile({
  binName: 'composer-prediction-e2e',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  await runFixtureTurn(ctx, { task: 'first' })
  const second = await runFixtureTurn(ctx, { task: 'second' })
  const session = ctx.sessions.get(SessionId(second.sessionId))
  if (session === undefined) throw new Error(`composer-prediction driver: session "${second.sessionId}" is not registered`)
  const deadline = Date.now() + PREDICTION_DEADLINE_MS
  while (!predicted(session)) {
    if (Date.now() > deadline) throw new Error('composer-prediction driver: the prediction did not settle before its deadline')
    await delay(PREDICTION_POLL_MS)
  }
  await ctx.sessions.flush(session)
} finally {
  await ctx.fiber.dispose()
}
