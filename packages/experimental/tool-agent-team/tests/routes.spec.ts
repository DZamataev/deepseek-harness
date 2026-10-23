import { describe, expect, it, vi } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import {
  TeammateRolesSchema,
  preflightTeammatePreset,
  preflightTeammateRoute,
  providerParameterDescription,
  resolveTeamRoutes,
  roleParameterDescription,
  routeSelectionEnabled,
  selectTeammateRoute,
} from '../src/routes.ts'
import type { TeammateRoleConfig } from '../src/routes.ts'

const SIGNAL = new AbortController().signal
const REVIEWER: TeammateRoleConfig = {
  description: 'Reviews diffs',
  provider: 'codex-lb',
  model: 'gpt-6.1-sol',
  reasoningEffort: 'high',
  instructions: 'Review critically.',
}
const ROUTES = resolveTeamRoutes(
  [{ provider: 'anthropic', model: 'claude-sonnet-5-5' }, { provider: 'codex-lb', model: 'gpt-6.1-sol' }],
  { 'gpt-reviewer': REVIEWER, 'gpt-worker': { description: 'Implements tasks', provider: 'codex-lb', model: 'gpt-6-sol' } },
)

describe('resolveTeamRoutes', () => {
  it('allows configured models first, then role routes not already listed', () => {
    expect(ROUTES.allowed).toEqual([
      { provider: 'anthropic', model: 'claude-sonnet-5-5' },
      { provider: 'codex-lb', model: 'gpt-6.1-sol' },
      { provider: 'codex-lb', model: 'gpt-6-sol' },
    ])
    expect([...ROUTES.roles.keys()]).toEqual(['gpt-reviewer', 'gpt-worker'])
    expect(routeSelectionEnabled(ROUTES)).toBe(true)
    expect(routeSelectionEnabled(resolveTeamRoutes([], {}))).toBe(false)
    expect(routeSelectionEnabled(resolveTeamRoutes([], { solo: REVIEWER }))).toBe(true)
  })

  it.each([
    ['a duplicate route', [{ provider: 'p', model: 'm' }, { provider: 'p', model: 'm' }], {}, 'models repeats route "p/m"'],
    ['an empty model provider', [{ provider: ' ', model: 'm' }], {}, 'models[0].provider must be non-empty'],
    ['an empty model id', [{ provider: 'p', model: '' }], {}, 'models[0].model must be non-empty'],
    ['an uppercase role name', [], { Reviewer: REVIEWER }, 'role name "Reviewer" must match'],
    ['a role name starting with a digit', [], { '1st': REVIEWER }, 'role name "1st" must match'],
    ['an empty role description', [], { r: { ...REVIEWER, description: '' } }, 'roles.r.description must be non-empty'],
    ['an empty role provider', [], { r: { ...REVIEWER, provider: '' } }, 'roles.r.provider must be non-empty'],
    ['an empty role model', [], { r: { ...REVIEWER, model: ' ' } }, 'roles.r.model must be non-empty'],
    ['a padded model provider', [{ provider: ' p', model: 'm' }], {}, 'models[0].provider must not have surrounding whitespace'],
    ['a padded model id', [{ provider: 'p', model: 'm ' }], {}, 'models[0].model must not have surrounding whitespace'],
    ['a padded role provider', [], { r: { ...REVIEWER, provider: 'p\n' } }, 'roles.r.provider must not have surrounding whitespace'],
    ['a padded role model', [], { r: { ...REVIEWER, model: ' m' } }, 'roles.r.model must not have surrounding whitespace'],
    ['a padded role effort', [], { r: { ...REVIEWER, reasoningEffort: 'high ' } }, 'roles.r.reasoningEffort must not have surrounding whitespace'],
    ['an empty role effort', [], { r: { ...REVIEWER, reasoningEffort: '' } }, 'roles.r.reasoningEffort must be non-empty'],
    ['a padded role preset', [], { r: { ...REVIEWER, agentPreset: ' team-codex' } }, 'roles.r.agentPreset must not have surrounding whitespace'],
    ['an empty role preset', [], { r: { ...REVIEWER, agentPreset: ' ' } }, 'roles.r.agentPreset must be non-empty'],
  ] as const)('rejects %s', (_case, models, roles, message) => {
    expect(() => resolveTeamRoutes(models, roles)).toThrow(message)
  })

  it('rejects an invalid role name in the Loader schema', () => {
    expect(() => TeammateRolesSchema({ 'Bad Name': REVIEWER })).toThrow()
    expect(TeammateRolesSchema({ 'gpt-reviewer': REVIEWER })).toEqual({ 'gpt-reviewer': REVIEWER })
  })
})

describe('route parameter descriptions', () => {
  it('lists roles with their routes and every allowed route', () => {
    expect(roleParameterDescription(ROUTES)).toContain(
      'Roles: gpt-reviewer: Reviews diffs (codex-lb/gpt-6.1-sol, high); gpt-worker: Implements tasks (codex-lb/gpt-6-sol).')
    expect(providerParameterDescription(ROUTES)).toContain(
      'Allowed routes: anthropic/claude-sonnet-5-5, codex-lb/gpt-6.1-sol, codex-lb/gpt-6-sol.')
  })
})

describe('selectTeammateRoute', () => {
  it('inherits the Lead route when nothing is selected', () => {
    expect(selectTeammateRoute(ROUTES, {})).toBeUndefined()
  })

  it('selects a role route, its effort, and its instructions', () => {
    expect(selectTeammateRoute(ROUTES, { role: 'gpt-reviewer' })).toEqual({
      route: { provider: 'codex-lb', model: 'gpt-6.1-sol', reasoningEffort: ReasoningEffortId('high') },
      instructions: { role: 'gpt-reviewer', text: 'Review critically.' },
    })
    expect(selectTeammateRoute(ROUTES, { role: 'gpt-reviewer', reasoning_effort: 'max' })?.route)
      .toEqual({ provider: 'codex-lb', model: 'gpt-6.1-sol', reasoningEffort: ReasoningEffortId('max') })
    expect(selectTeammateRoute(ROUTES, { role: 'gpt-worker' }))
      .toEqual({ route: { provider: 'codex-lb', model: 'gpt-6-sol' } })
  })

  it('carries a role preset with its role name', () => {
    const routes = resolveTeamRoutes([], { 'gpt-reviewer': { ...REVIEWER, agentPreset: 'team-codex' } })
    expect(selectTeammateRoute(routes, { role: 'gpt-reviewer' })).toEqual({
      route: { provider: 'codex-lb', model: 'gpt-6.1-sol', reasoningEffort: ReasoningEffortId('high') },
      instructions: { role: 'gpt-reviewer', text: 'Review critically.' },
      agentPreset: { role: 'gpt-reviewer', id: 'team-codex' },
    })
  })

  it('selects an allowed provider/model route with an optional effort', () => {
    expect(selectTeammateRoute(ROUTES, { provider: 'anthropic', model: 'claude-sonnet-5-5' }))
      .toEqual({ route: { provider: 'anthropic', model: 'claude-sonnet-5-5' } })
    expect(selectTeammateRoute(ROUTES, { provider: 'codex-lb', model: 'gpt-6-sol', reasoning_effort: 'low' }))
      .toEqual({ route: { provider: 'codex-lb', model: 'gpt-6-sol', reasoningEffort: ReasoningEffortId('low') } })
  })

  it.each([
    ['role with provider', { role: 'gpt-reviewer', provider: 'codex-lb' }, 'choose either role or provider/model'],
    ['role with model', { role: 'gpt-reviewer', model: 'gpt-6-sol' }, 'choose either role or provider/model'],
    ['an unknown role', { role: 'missing' }, 'unknown teammate role "missing"; configured roles: gpt-reviewer, gpt-worker'],
    ['provider alone', { provider: 'codex-lb' }, 'provider and model must be supplied together'],
    ['model alone', { model: 'gpt-6-sol' }, 'provider and model must be supplied together'],
    ['a route outside the list', { provider: 'codex-lb', model: 'gpt-5' },
      'teammate LLM route "codex-lb/gpt-5" is not allowed; allowed routes: anthropic/claude-sonnet-5-5, codex-lb/gpt-6.1-sol, codex-lb/gpt-6-sol'],
    ['effort alone', { reasoning_effort: 'high' }, 'reasoning_effort requires role or provider/model'],
    ['an empty effort', { role: 'gpt-reviewer', reasoning_effort: ' ' }, 'reasoning_effort must be non-empty'],
  ] as const)('rejects %s', (_case, request, message) => {
    expect(() => selectTeammateRoute(ROUTES, request)).toThrow(expect.objectContaining({
      message,
      code: 'TEAM_INVALID_ARGUMENT',
    }))
  })

  it('names the absence of roles when only models are configured', () => {
    const modelsOnly = resolveTeamRoutes([{ provider: 'p', model: 'm' }], {})
    expect(() => selectTeammateRoute(modelsOnly, { role: 'any' })).toThrow('configured roles: none')
  })
})

describe('preflightTeammateRoute', () => {
  it('resolves the route through the LLM runtime with the tool signal', async () => {
    const resolveCallConfig = vi.fn().mockResolvedValue({})
    const route = { provider: 'codex-lb', model: 'gpt-6-sol', reasoningEffort: ReasoningEffortId('high') }
    await preflightTeammateRoute({ resolveCallConfig }, route, SIGNAL)
    await preflightTeammateRoute({ resolveCallConfig }, { provider: 'p', model: 'm' }, SIGNAL)
    expect(resolveCallConfig.mock.calls).toEqual([[route, SIGNAL], [{ provider: 'p', model: 'm' }, SIGNAL]])
  })

  it('fails clearly without the llm service', async () => {
    await expect(preflightTeammateRoute(undefined, { provider: 'p', model: 'm' }, SIGNAL)).rejects.toMatchObject({
      message: 'cannot resolve the selected teammate LLM route because the `llm` service is unavailable',
      code: 'TEAM_LLM_UNAVAILABLE',
    })
  })
})

describe('preflightTeammatePreset', () => {
  const SELECTION = { role: 'gpt-reviewer', id: 'team-codex' }
  const row = (moduleName: string, enabled: boolean | 'conditional' = true) => ({ entryId: null, moduleName, enabled })
  const registry = (presets: Array<{ id: string; broken?: string; rows: Array<ReturnType<typeof row>> }>) => ({
    compositionInventory: vi.fn().mockResolvedValue(presets.map(preset => ({ isDefault: false, ...preset }))),
  })

  it.each([
    ['the package name', '@deepseek-ai/dsh-experimental-tool-agent-team', true],
    ['a conditional row', '@deepseek-ai/dsh-experimental-tool-agent-team', 'conditional' as const],
    ['a Loader builtin alias', 'cordis:tool-agent-team', true],
  ])('accepts a preset that mounts this plugin through %s', async (_case, moduleName, enabled) => {
    await expect(preflightTeammatePreset(registry([{ id: 'team-codex', rows: [row('@deepseek-ai/dsh-tool-fs'), row(moduleName, enabled)] }]), SELECTION))
      .resolves.toBeUndefined()
  })

  it.each([
    ['without the agentPresets service', undefined,
      'role "gpt-reviewer" selects agent preset "team-codex", but the `agentPresets` service is unavailable'],
    ['for an undeclared preset', registry([{ id: 'team', rows: [] }]),
      'role "gpt-reviewer" selects unknown agent preset "team-codex"; declared presets: team'],
    ['when no preset is declared', registry([]), 'declared presets: none'],
    ['for a broken preset', registry([{ id: 'team-codex', broken: 'missing module', rows: [] }]),
      'agent preset "team-codex", which failed to load: missing module'],
    ['for a preset without this plugin', registry([{ id: 'team-codex', rows: [row('@deepseek-ai/dsh-tool-agent-teamwork')] }]),
      'which does not mount tool-agent-team; its teammate would have no Team tools'],
    ['for a preset whose plugin row is disabled', registry([{ id: 'team-codex', rows: [row('cordis:tool-agent-team', false)] }]),
      'which does not mount tool-agent-team'],
  ])('fails %s', async (_case, presets, message) => {
    await expect(preflightTeammatePreset(presets, SELECTION)).rejects.toThrow(message)
    await expect(preflightTeammatePreset(presets, SELECTION)).rejects.toMatchObject({ code: 'TEAM_PRESET_UNAVAILABLE' })
  })
})
