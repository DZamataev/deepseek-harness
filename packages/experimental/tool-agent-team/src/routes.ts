/** Configured teammate LLM routes and roles, and the model-facing route selection of `spawn_teammate`. */

import z from '@deepseek-ai/schemastery'
import { TeamError } from '@deepseek-ai/dsh-experimental-agent-team'
import type { TeammateRoute } from '@deepseek-ai/dsh-experimental-agent-team'
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'

/** Role names follow the lower-kebab teammate-name style and start with a letter. */
const ROLE_NAME = /^[a-z][a-z0-9-]*$/u

/** One exact LLM route the Lead may select for a teammate. */
export interface TeammateModelRoute {
  /** Registered LLM provider id. */
  readonly provider: string
  /** Provider-owned exact model id. */
  readonly model: string
}

/** One named teammate preset; its route is implicitly allowed. */
export interface TeammateRoleConfig {
  /** Model-facing summary of the role. */
  readonly description: string
  /** Registered LLM provider id. */
  readonly provider: string
  /** Provider-owned exact model id. */
  readonly model: string
  /** Adapter-owned reasoning effort; the selected model's default applies when omitted. */
  readonly reasoningEffort?: string
  /** Text sent to the teammate before the Lead's initial task. */
  readonly instructions?: string
  /**
   * Agent Preset that composes a `fresh` teammate of this role instead of the
   * Lead's preset; it must mount this plugin so the teammate keeps the Team tools.
   */
  readonly agentPreset?: string
}

/** Loader schema for one allowed route. */
export const TeammateModelRouteSchema: z<TeammateModelRoute> = z.object({
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
})

/** Loader schema for one role. */
export const TeammateRoleSchema: z<TeammateRoleConfig> = z.object({
  description: z.string().min(1).required(),
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
  reasoningEffort: z.string().min(1),
  instructions: z.string().min(1),
  agentPreset: z.string().min(1),
})

/** Loader schema for the role dictionary, keyed by role name. */
export const TeammateRolesSchema: z<Readonly<Record<string, TeammateRoleConfig>>> =
  z.dict(TeammateRoleSchema, z.string().pattern(ROLE_NAME))

/** Validated route configuration of one plugin instance. */
export interface TeamRoutes {
  /** Roles by name, in configuration order. */
  readonly roles: ReadonlyMap<string, TeammateRoleConfig>
  /** Explicitly selectable routes: configured models, then routes of roles without an Agent Preset not already listed. */
  readonly allowed: readonly TeammateModelRoute[]
}

/** Model-facing route arguments of `spawn_teammate`. */
export interface TeammateRouteRequest {
  readonly role?: string
  readonly provider?: string
  readonly model?: string
  readonly reasoning_effort?: string
}

/** Route and role instructions chosen for one teammate. */
export interface TeammateSelection {
  /** LLM route forwarded to the Team service. */
  readonly route: TeammateRoute
  /** Selected role name and its instructions, when the role has instructions. */
  readonly instructions?: { readonly role: string; readonly text: string }
  /** Agent Preset of the selected role, when the role names one. */
  readonly agentPreset?: { readonly role: string; readonly id: string }
}

/** Reject one blank or whitespace-padded configuration value; padded ids never match a registered route. */
function requireText(value: string | undefined, field: string): void {
  if (value === undefined) return
  if (value.trim().length === 0) throw new Error(`tool-agent-team ${field} must be non-empty`)
  if (value !== value.trim()) throw new Error(`tool-agent-team ${field} must not have surrounding whitespace`)
}

/**
 * Validate configured routes and roles. Misconfiguration throws, so plugin
 * load fails before any tool is registered.
 * @param models - Configured exact routes.
 * @param roles - Configured roles by name.
 * @returns the validated roles and the allowed routes: configured models plus routes of roles without `agentPreset`.
 */
export function resolveTeamRoutes(
  models: readonly TeammateModelRoute[],
  roles: Readonly<Record<string, TeammateRoleConfig>>,
): TeamRoutes {
  const allowed: TeammateModelRoute[] = []
  const seen = new Set<string>()
  const key = (route: TeammateModelRoute): string => `${route.provider}\0${route.model}`
  for (const [index, route] of models.entries()) {
    requireText(route.provider, `models[${index}].provider`)
    requireText(route.model, `models[${index}].model`)
    if (seen.has(key(route))) {
      throw new Error(`tool-agent-team models repeats route "${route.provider}/${route.model}"`)
    }
    seen.add(key(route))
    allowed.push({ provider: route.provider, model: route.model })
  }
  const validated = new Map<string, TeammateRoleConfig>()
  for (const [name, role] of Object.entries(roles)) {
    if (!ROLE_NAME.test(name)) {
      throw new Error(`tool-agent-team role name "${name}" must match ${ROLE_NAME.source}`)
    }
    for (const field of ['description', 'provider', 'model', 'reasoningEffort', 'instructions', 'agentPreset'] as const) {
      requireText(role[field], `roles.${name}.${field}`)
    }
    validated.set(name, role)
    // A preset role's route stays selectable only through the role, so a raw
    // provider/model choice cannot start that model without the role's preset.
    if (role.agentPreset === undefined && !seen.has(key(role))) {
      seen.add(key(role))
      allowed.push({ provider: role.provider, model: role.model })
    }
  }
  return { roles: validated, allowed }
}

/**
 * Whether a plugin instance exposes route selection to the model.
 * @param routes - Validated route configuration.
 * @returns whether any role or allowed route is configured.
 */
export function routeSelectionEnabled(routes: TeamRoutes): boolean {
  return routes.allowed.length > 0 || routes.roles.size > 0
}

/** Render routes as `provider/model` for model-facing text. */
function routeList(routes: TeamRoutes): string {
  return routes.allowed.map(route => `${route.provider}/${route.model}`).join(', ')
}

/**
 * Describe the `role` parameter with every configured role.
 * @param routes - Validated route configuration with at least one role.
 * @returns parameter description listing `name: description (provider/model[, effort])`.
 */
export function roleParameterDescription(routes: TeamRoutes): string {
  const roles = [...routes.roles].map(([name, role]) =>
    `${name}: ${role.description} (${role.provider}/${role.model}${role.reasoningEffort === undefined ? '' : `, ${role.reasoningEffort}`})`)
  return `Configured teammate role that selects its LLM route and instructions. Do not combine with provider/model. Roles: ${roles.join('; ')}.`
}

/**
 * Describe the `provider` parameter with every allowed route.
 * @param routes - Validated route configuration with at least one allowed route.
 * @returns parameter description listing allowed `provider/model` routes.
 */
export function providerParameterDescription(routes: TeamRoutes): string {
  return `LLM provider for the teammate; supply together with model. Omit role, provider, and model to use the Lead's route. Allowed routes: ${routeList(routes)}.`
}

/**
 * Resolve the model-facing route arguments of one `spawn_teammate` call.
 * Omitting every route argument inherits the Lead route.
 * @param routes - Validated route configuration.
 * @param request - Route arguments from the tool call.
 * @returns the selected route, or `undefined` when the teammate inherits the Lead route.
 */
export function selectTeammateRoute(routes: TeamRoutes, request: TeammateRouteRequest): TeammateSelection | undefined {
  const { role: roleName, provider, model, reasoning_effort: effort } = request
  if (effort !== undefined && effort.trim().length === 0) {
    throw new TeamError('reasoning_effort must be non-empty', 'TEAM_INVALID_ARGUMENT')
  }
  if (roleName !== undefined) {
    if (provider !== undefined || model !== undefined) {
      throw new TeamError('choose either role or provider/model', 'TEAM_INVALID_ARGUMENT')
    }
    const role = routes.roles.get(roleName)
    if (role === undefined) {
      throw new TeamError(
        `unknown teammate role "${roleName}"; configured roles: ${[...routes.roles.keys()].join(', ') || 'none'}`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    const reasoningEffort = effort ?? role.reasoningEffort
    return {
      route: {
        provider: role.provider,
        model: role.model,
        ...reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(reasoningEffort) },
      },
      ...role.instructions === undefined ? {} : { instructions: { role: roleName, text: role.instructions } },
      ...role.agentPreset === undefined ? {} : { agentPreset: { role: roleName, id: role.agentPreset } },
    }
  }
  if (provider !== undefined || model !== undefined) {
    if (provider === undefined || model === undefined) {
      throw new TeamError('provider and model must be supplied together', 'TEAM_INVALID_ARGUMENT')
    }
    if (!routes.allowed.some(route => route.provider === provider && route.model === model)) {
      throw new TeamError(
        `teammate LLM route "${provider}/${model}" is not allowed; allowed routes: ${routeList(routes)}`,
        'TEAM_INVALID_ARGUMENT',
      )
    }
    return {
      route: { provider, model, ...effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) } },
    }
  }
  if (effort !== undefined) {
    throw new TeamError('reasoning_effort requires role or provider/model', 'TEAM_INVALID_ARGUMENT')
  }
  return undefined
}

/**
 * Resolve a selected route through the live LLM runtime before a teammate name
 * is consumed. The runtime owns provider lookup, exact-model metadata, and
 * effort validation; an unknown provider, model, or effort rejects here.
 * @param llm - Live LLM runtime, or `undefined` when the `llm` service is not mounted.
 * @param route - Selected teammate route.
 * @param signal - Tool-call cancellation signal.
 */
export async function preflightTeammateRoute(
  llm: Pick<LlmRuntime, 'resolveCallConfig'> | undefined,
  route: TeammateRoute,
  signal: AbortSignal,
): Promise<void> {
  if (llm === undefined) {
    throw new TeamError(
      'cannot resolve the selected teammate LLM route because the `llm` service is unavailable',
      'TEAM_LLM_UNAVAILABLE',
    )
  }
  await llm.resolveCallConfig({
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort },
  }, signal)
}

/** Module specifiers naming this plugin: its package (or a subpath) and a Loader builtin alias. */
const TEAM_TOOL_MODULE = /(?:^|[/:])(?:dsh-experimental-)?tool-agent-team(?:\/|$)/u

/**
 * Check a role's Agent Preset before a teammate name is consumed: the preset
 * must be declared, must load, and must carry an enabled row of this plugin,
 * because a teammate composed without it has no Team tools and cannot report
 * to the Lead. Rows are matched by module specifier.
 * @param presets - Agent Preset registry, or `undefined` when the `agentPresets` service is not mounted.
 * @param selection - Selected role and its preset id.
 */
export async function preflightTeammatePreset(
  presets: Pick<AgentPresetRegistry, 'compositionInventory'> | undefined,
  selection: NonNullable<TeammateSelection['agentPreset']>,
): Promise<void> {
  const { role, id } = selection
  if (presets === undefined) {
    throw new TeamError(
      `role "${role}" selects agent preset "${id}", but the \`agentPresets\` service is unavailable`,
      'TEAM_PRESET_UNAVAILABLE',
    )
  }
  const inventory = await presets.compositionInventory()
  const preset = inventory.find(candidate => candidate.id === id)
  if (preset === undefined) {
    throw new TeamError(
      `role "${role}" selects unknown agent preset "${id}"; declared presets: ${inventory.map(candidate => candidate.id).join(', ') || 'none'}`,
      'TEAM_PRESET_UNAVAILABLE',
    )
  }
  if (preset.broken !== undefined) {
    throw new TeamError(`role "${role}" selects agent preset "${id}", which failed to load: ${preset.broken}`, 'TEAM_PRESET_UNAVAILABLE')
  }
  if (!preset.rows.some(row => row.enabled !== false && TEAM_TOOL_MODULE.test(row.moduleName))) {
    throw new TeamError(
      `role "${role}" selects agent preset "${id}", which does not mount tool-agent-team; its teammate would have no Team tools`,
      'TEAM_PRESET_UNAVAILABLE',
    )
  }
}
