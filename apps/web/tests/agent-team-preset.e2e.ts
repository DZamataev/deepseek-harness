/** The Agent Teams bundle over the shipped Web composition: Team tools only in the `team` preset. */

import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

const OVERLAY = fileURLToPath(new URL('./agent-team-panel.overlay.yml', import.meta.url))
const INSTALL_ANCHORS = [
  fileURLToPath(new URL('../../../packages/experimental/agent-team-profile/package.json', import.meta.url)),
]

describe('web e2e: Agent Teams preset', () => {
  let scaffold: WebScaffold

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, extraInstallAnchors: INSTALL_ANCHORS })
  }, 120_000)

  afterAll(async () => {
    await scaffold?.close()
  })

  /** Tool names a new Agent composed from `preset` sees. */
  async function toolNames(preset: string): Promise<string[]> {
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId(`agent-team-preset-${preset}`),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: preset },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, preset).then(() => undefined),
    })
    try {
      expect(scaffold.ctx.agentPresets.composedPreset(handle.agent.ctx)).toBe(preset)
      return scaffold.ctx.tools.schemas(handle.agent).map(tool => tool.name)
    } finally {
      await handle.dispose()
    }
  }

  it('offers the Team preset and keeps the Host Team tool row unmounted', async () => {
    const roster = await scaffold.ctx.agentPresets.remoteExportList()
    expect(roster.presets.find(preset => preset.id === 'team')).toMatchObject({ name: 'Agent Teams', isDefault: false })
    expect(roster.presets.find(preset => preset.isDefault)?.id).toBe('standard')
    const rows = Object.fromEntries([...scaffold.ctx.loader.entries()]
      .filter(entry => ['agent-team', 'tool-agent-team', 'ui-agent-team', 'preset-team'].includes(entry.options.id))
      .map(entry => [entry.options.id, entry.fiber !== undefined]))
    expect(rows).toEqual({ 'agent-team': true, 'tool-agent-team': false, 'ui-agent-team': true, 'preset-team': true })
  })

  it('gives Team Agents the Team tools and standard Agents the subagent tools', async () => {
    const team = await toolNames('team')
    expect(team).toEqual(expect.arrayContaining(['spawn_teammate', 'send_message', 'list_agents', 'interrupt_agent', 'workflow']))
    expect(team).not.toContain('subagent')
    expect(team).not.toContain('subagent_fork')

    const standard = await toolNames('standard')
    expect(standard).toEqual(expect.arrayContaining(['subagent', 'subagent_fork', 'send_message', 'list_agents', 'interrupt_agent']))
    expect(standard).not.toContain('spawn_teammate')
    expect(standard.filter(name => name.startsWith('team_'))).toEqual([])
  })
})
