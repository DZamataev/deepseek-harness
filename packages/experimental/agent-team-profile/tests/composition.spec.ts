/** The bundle composed over the shipped profiles gives each Agent one family of child-control tools. */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { applyEntryPatches, entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { evaluate, isJsExpr, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'

const BASE = '@deepseek-ai/dsh-base'
const WEB = '@deepseek-ai/dsh-web-app'
const HEADLESS = '@deepseek-ai/dsh-headless'
const TEAM = '@deepseek-ai/dsh-experimental-agent-team-profile'
const BUNDLE_DIRS: Record<string, string> = {
  [BASE]: 'bundle/base',
  [WEB]: 'bundle/web-app',
  [HEADLESS]: 'bundle/headless',
  [TEAM]: 'experimental/agent-team-profile',
}

const PRESET = '@deepseek-ai/dsh-agent-preset'
const TEAM_TOOLS = '@deepseek-ai/dsh-experimental-tool-agent-team'
const DELEGATION_TOOLS = new Set([
  '@deepseek-ai/dsh-tool-subagent-control',
  '@deepseek-ai/dsh-tool-subagent-control/list-agents',
  '@deepseek-ai/dsh-tool-subagent',
])
const DELEGATION_IDS = new Set(['tool-subagent-control', 'tool-subagent-list-agents', 'tool-subagent', 'tool-subagent-fork'])

/** Loader context fields a `disabled` expression reads. */
interface LoaderScope {
  get(name: string): unknown
}

function bundlePatches(name: string): PatchOptions[] {
  const root = new URL(`../../../${BUNDLE_DIRS[name]!}/`, import.meta.url)
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
    name: string
    dsh: { bundle: { patch: string | string[] } }
  }
  expect(manifest.name).toBe(name)
  return [manifest.dsh.bundle.patch].flat().flatMap((file) => {
    const parsed = yaml.load(readFileSync(new URL(file, root), 'utf8'), { schema: entryListSchema })
    if (!Array.isArray(parsed)) throw new Error(`${name} ${file} must be a patch list`)
    return parsed as PatchOptions[]
  })
}

/** Compose bundles in profile order over an empty root, failing on any skipped patch. */
function compose(bundles: readonly string[]): EntryOptions[] {
  const warnings: string[] = []
  const entries = applyEntryPatches([], bundles.flatMap(bundlePatches), message => warnings.push(message))
  expect(warnings).toEqual([])
  return entries
}

/** A Loader context for a dsh profile started with `bundles`, or for a launch without a profile. */
function loaderScope(bundles?: readonly string[]): LoaderScope {
  const profileContext = bundles === undefined ? undefined : { startedBundles: bundles }
  return { get: name => name === 'profileContext' ? profileContext : undefined }
}

function enabled(row: EntryOptions, scope: LoaderScope): boolean {
  if (row.group) return true
  return isJsExpr(row.disabled) ? !evaluate(scope, row.disabled.__jsExpr) : !row.disabled
}

/** Active rows of an entry list, descending into active groups as the Loader mounts them. */
function active(rows: readonly EntryOptions[], scope: LoaderScope): EntryOptions[] {
  return rows.filter(row => enabled(row, scope)).flatMap(row =>
    row.group && Array.isArray(row.config) ? [row, ...active(row.config as EntryOptions[], scope)] : [row])
}

function row(rows: readonly EntryOptions[], id: string): EntryOptions {
  const found = rows.find(entry => entry.id === id)
  if (found === undefined) throw new Error(`no row ${id}`)
  return found
}

interface PresetConfig {
  id: string
  plugins: EntryOptions[]
}

function presets(rows: readonly EntryOptions[]): Map<string, EntryOptions> {
  return new Map(rows.filter(entry => entry.name === PRESET).map(entry => [(entry.config as PresetConfig).id, entry]))
}

/** Plugin names one Agent of `preset` mounts: active Host rows plus that preset's active plugins. */
function agentPlugins(rows: readonly EntryOptions[], scope: LoaderScope, preset?: EntryOptions): string[] {
  const host = active(rows, scope).filter(entry => entry.name !== PRESET)
  const own = preset === undefined ? [] : active((preset.config as PresetConfig).plugins, scope)
  return [...host, ...own].map(entry => entry.name)
}

function families(plugins: readonly string[]): { team: boolean; delegation: boolean } {
  return { team: plugins.includes(TEAM_TOOLS), delegation: plugins.some(name => DELEGATION_TOOLS.has(name)) }
}

function withoutRows(rows: readonly EntryOptions[], drop: (entry: EntryOptions) => boolean): EntryOptions[] {
  return rows.filter(entry => !drop(entry)).map(entry =>
    entry.group && Array.isArray(entry.config)
      ? { ...entry, config: withoutRows(entry.config as EntryOptions[], drop) }
      : entry)
}

/** Every row of an entry list, including rows nested in groups. */
function descendants(rows: readonly EntryOptions[]): EntryOptions[] {
  return rows.flatMap(entry =>
    entry.group && Array.isArray(entry.config) ? [entry, ...descendants(entry.config as EntryOptions[])] : [entry])
}

describe('Agent Teams bundle in the Web composition', () => {
  const started = [BASE, WEB, TEAM]
  const scope = loaderScope(started)
  const before = compose([BASE, WEB])
  const after = compose(started)

  it('composes Team tools only through the Team preset', () => {
    const roster = presets(after)
    const team = roster.get('team')
    expect(team).toBeDefined()
    expect(enabled(team!, scope)).toBe(true)
    expect(enabled(row(after, 'tool-agent-team'), scope)).toBe(false)
    expect(enabled(row(after, 'agent-team'), scope)).toBe(true)
    expect(enabled(row(after, 'ui-agent-team'), scope)).toBe(true)

    expect(families(agentPlugins(after, scope, team))).toEqual({ team: true, delegation: false })
    expect(families(agentPlugins(after, scope, roster.get('standard')))).toEqual({ team: false, delegation: true })
    for (const [id, preset] of roster) {
      const { team: hasTeam, delegation } = families(agentPlugins(after, scope, preset))
      expect(hasTeam && delegation, `preset ${id} mounts both tool families`).toBe(false)
    }
  })

  it('leaves every shipped preset unchanged', () => {
    const shipped = presets(before)
    const composed = presets(after)
    expect([...composed.keys()].sort()).toEqual([...shipped.keys(), 'team'].sort())
    for (const [id, preset] of shipped) expect(composed.get(id), id).toEqual(preset)
  })

  it('declares the Team preset as standard without subagent delegation, plus the Host Team tool row', () => {
    const roster = presets(after)
    const team = roster.get('team')!.config as PresetConfig
    const standard = roster.get('standard')!.config as PresetConfig
    const teamTools = team.plugins.filter(entry => entry.name === TEAM_TOOLS)
    expect(teamTools).toHaveLength(1)
    const hostTools = row(after, 'tool-agent-team')
    expect(teamTools[0]).toEqual({ id: hostTools.id, name: hostTools.name, config: hostTools.config as Record<string, string> })
    expect(withoutRows(team.plugins, entry => entry.name === TEAM_TOOLS))
      .toEqual(withoutRows(standard.plugins, entry => DELEGATION_IDS.has(entry.id)))
  })

  it('places the Team tool row where standard mounts its delegation group, outside every group', () => {
    const roster = presets(after)
    const team = (roster.get('team')!.config as PresetConfig).plugins
    const standard = (roster.get('standard')!.config as PresetConfig).plugins
    const position = standard.findIndex(entry => entry.id === 'delegation')
    expect(position).toBeGreaterThan(0)
    expect(team.findIndex(entry => entry.name === TEAM_TOOLS)).toBe(position)
    expect(team[position + 1]?.id).toBe('delegation')
    const nested = team.filter(entry => entry.group && Array.isArray(entry.config))
      .flatMap(group => descendants(group.config as EntryOptions[]))
    expect(nested.filter(entry => entry.name === TEAM_TOOLS)).toEqual([])
  })
})

describe('Agent Teams bundle in a composition without presets', () => {
  for (const [label, scope] of [
    ['a headless profile', loaderScope([BASE, HEADLESS, TEAM])],
    ['a launch without a profile', loaderScope()],
  ] as const) {
    it(`mounts Team tools at the Host and disables subagent delegation in ${label}`, () => {
      const entries = compose([BASE, HEADLESS, TEAM])
      const host = active(entries, scope).map(entry => entry.id)
      expect(host).toEqual(expect.arrayContaining(['agent-team', 'tool-agent-team', 'ui-agent-team']))
      for (const id of DELEGATION_IDS) expect(host).not.toContain(id)
      expect(host).not.toContain('preset-team')
      expect(families(agentPlugins(entries, scope))).toEqual({ team: true, delegation: false })
    })
  }
})
