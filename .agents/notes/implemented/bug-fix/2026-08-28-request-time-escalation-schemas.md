# Agent Note: Escalation schemas follow the request's standing policy

Status: implemented

English | [中文](2026-08-28-request-time-escalation-schemas.zh.md)

## Problem

Sandbox-enforcing tools registered one process-wide escalation schema containing `workspace-write` and `danger-full-access`. Execution correctly required a target strictly wider than the calling session's effective mode, but request assembly sent the complete registered enum to every model. A session already at `danger-full-access` therefore still offered `sandbox_permissions: danger-full-access`; models could select that apparent option and receive `sandbox escalation to "danger-full-access" is not strictly wider than this call's current "danger-full-access" mode` before the command ran. Subagents inherited the same mismatch because their delegated mode lived in the session log while the schema ignored it.

## Decision

`ToolDefinition.projectModelSchema(agent, schema)` may synchronously project a registered tool's description and parameters for one request from reconstructable agent/session state. Projected parameters may narrow the accepted inputs but never admit an argument object that the registered validator rejects. `ToolRuntime` applies the projection to native function schemas and generated PTC SDK bindings. Agentless `ctx.tools.schemas()` and the generated tool catalog retain the registered fallback, and execution continues to validate against that registered definition.

The sandbox consumers fold the calling session through `ctx.sandboxPolicy`, select `WIDER_MODES[effectiveMode]`, and project their escalation pair together. `read-only` advertises `workspace-write | danger-full-access`; `workspace-write` advertises only `danger-full-access`; `danger-full-access` omits `sandbox_permissions`, `justification`, and shell-description clauses that instruct escalation. `bash`, `pwsh`, `write`, and `edit` use the same projection helper. The strict-wider execution check remains authoritative for injected, stale, or non-model calls.

## Testing

Core tool tests prove the callback stays out of agentless schemas, changes native request fields, and drives generated PTC SDK text. Each sandbox consumer assembles requests for all three modes and asserts the exact enum or paired omission. Recorded-session sidecars separately pin the read-only, workspace-write, and full-access request schemas. Existing execution tests continue to prove that an injected non-widening escalation runs nothing and opens no approval prompt.

## Alternatives considered

**Drop escalation fields whenever the deployment default is `danger-full-access`.** Rejected: a session can override that default to `read-only`, including delegated subagents, and still needs both escalation targets.

**Keep the static enum and rely on prompt prose.** Rejected: the JSON schema presents the invalid target as callable API, and model behavior showed that prose does not reliably override that affordance.

**Re-register one tool definition per session or mode switch.** Rejected: execution behavior is identical across modes, so duplicating registry entries would add lifecycle ownership and churn. Request assembly already carries the exact agent and is the point that owns model-visible fields.

**Remove the strict-wider execution check after narrowing the schema.** Rejected: schema omission is advertising, not enforcement; direct callers, stale requests, and unadvertised open-object properties can still reach execution.

## Consequences

Ordinary calls at `danger-full-access` no longer carry escalation arguments or guidance, so they reach the executor instead of failing as self-escalations. Narrower sessions retain exactly the recovery targets they can use. A mode switch can change tool-schema tokens on the next request and therefore invalidate KV-cache reuse from the changed definition, while the registered catalog and execution validator remain stable.
