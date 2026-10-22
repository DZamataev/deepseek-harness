---
description: "Enable team collaboration, tools, and the Web roster and task board with one experimental bundle."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-agent-team-profile

English | [中文](README.zh.md)

## Summary

`dsh-experimental-agent-team-profile` enables [Agent Teams](../agent-team/README.md) collaboration, tools, and Web UI with one bundle. Delegate work to teammates and view members, shared tasks, and teammate sessions in Web. An Agent that receives the Team tools gets neither ordinary subagent delegation nor the global child controls whose names the Team tools reuse; Workflow can still create fresh children. In Web and Desktop, the Team tools belong to the **Agent Teams** preset, and the other presets keep subagent delegation. The bundle ships with dsh switched off. Enable it from the Plugins page or add it to an initialized profile.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Install into a profile

Add the package to an initialized profile, then run a task that asks the Lead to delegate work:

```sh
dsh plugin --profile headless add @deepseek-ai/dsh-experimental-agent-team-profile
dsh --profile headless "Use Agent Teams to split this task between two teammates, wait, and summarize."
```

The profile must already contain `@deepseek-ai/dsh-base`, whose Subagent services and provider rows this layer consumes. Removing the package with `dsh plugin --profile <name> remove @deepseek-ai/dsh-experimental-agent-team-profile` removes the bundle from the profile's ordered layer list.

Enable Agent Teams on the Web or Desktop Plugins page. Then choose **Agent Teams** in the preset picker of a new, blank session; Settings → Agent presets can make it the default for new tasks. Sessions of every other preset get no Team tools; `standard`, `ptc`, and `cordis` sessions keep `subagent`, `subagent_fork`, and the subagent child controls. A session's preset is fixed after its first turn, so start a new session to switch. For a CLI Web profile, use:

```sh
dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-profile
```

In an existing profile’s `package.json`, keep `@deepseek-ai/dsh-experimental-agent-team-profile` in `dsh.profile.bundles` and remove the separate `@deepseek-ai/dsh-experimental-agent-team-web-profile` entry. User patches targeting `ui-agent-team` still apply.

### What you get

The layer adds the Agent Teams domain and its scoped creation, roster, messaging, interruption, waiting, and task-board tools. Direct delegation uses `spawn_teammate`, which supports fresh and fork context. An Agent with the Team tools has no `subagent` or `subagent_fork` tool and no global child controls with the same names. In a headless profile, every session is such an Agent. In Web and Desktop, only Agents of the `team` preset and their teammates are. Workflow retains the base profile’s `spawn` provider, while the underlying Subagent services and both providers remain available to teammates and workflow.

In Web and Desktop conversations, the [Team UI](../client-ui-agent-team/README.md) displays the member roster and shared task board and opens teammate sessions. The same bundle switch controls the tools and browser UI. The Plugins page reads the bundle's [icon](icon.svg) from its `package.json.icon` declaration, including while the bundle is disabled.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package's runtime content is [`cordis.patch.yml`](cordis.patch.yml). Applied after `dsh-base`, the patch disables the Host rows `tool-subagent-control`, `tool-subagent-list-agents`, `tool-subagent`, and `tool-subagent-fork`, and inserts the Team service, tools, and UI with explicit providers and limits. The `agent-team` service and `ui-agent-team` always mount at the Host. The UI plugin has an inert Host entry; only the Web Client loader mounts its browser entry, so headless needs no Web server.

`dsh-web-app` disables those Host delegation rows itself and mounts delegation inside each Agent Preset's `plugins`, which a top-level patch cannot target. Two rows therefore depend on whether the dsh profile started with `@deepseek-ai/dsh-web-app` (`profileContext.startedBundles`). Without it, the Host `tool-agent-team` row mounts and the `preset-team` declaration is disabled. With it, the Host row is disabled and `preset-team` declares the `team` preset. That preset is the `dsh-web-app` `standard` plugin list with the four delegation rows replaced by the same `tool-agent-team` row. [`tests/composition.spec.ts`](tests/composition.spec.ts) composes the shipped bundles and fails when the copy drifts from `standard`, when a shipped preset changes, or when any Agent would mount both tool families. A launch without a dsh profile follows the headless rule.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Ordered patch over `dsh-base` |
| [`src/index.ts`](src/index.ts) | Empty module entry; the patch is the runtime content |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Experimental packages](../README.md) — incubation status and publication policy.
- [Agent Teams service](../agent-team/README.md) — durable roster and task board, plus direct messaging.
- [Agent Teams tools](../tool-agent-team/README.md) — the Team-scoped model tool surface.
- [Agent Teams browser UI](../client-ui-agent-team/README.md) — roster, task board, and teammate session navigation.
- [Base bundle](../../bundle/base/README.md) — the profile layer this patch extends.

-----

<a id="model-experience"></a>
## Model Experience

### Team policy and tools

#### What the model sees

The Team policy and schemas belong to [`@deepseek-ai/dsh-experimental-tool-agent-team`](../tool-agent-team/README.md). This bundle changes composition only: for an Agent with the Team tools, Team-scoped `list_agents`, `send_message`, and `interrupt_agent` replace the global continuable-child controls. Agents of other Web presets see the subagent tools and no Team tools. `spawn_teammate` is the direct delegation tool. Workflow’s `agent()` calls create fresh one-shot children; their prompts must contain the context needed for their tasks.

#### Token effect

The bundle adds the Team policy and tool schemas described by `@deepseek-ai/dsh-experimental-tool-agent-team`; it adds no prompt text of its own.

#### KV Cache effect

The shared system prompt and tool schemas remain prefix-stable while the bundle patch and configured tool schemas remain unchanged. Team identity is appended through runtime-context snapshots; [Team tools](../tool-agent-team/README.md#model-experience) define snapshot reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Opt-in only** — the package ships with the installation switched off; no shipped CLI, Web, SDK, ACP, or Python profile enables it.
- **Workflow child tools** — the [Team tool visibility limitation](../tool-agent-team/README.md#known-limitations-and-deferred-work) also applies to workflow children.
- **Shared checkout** — every teammate observes the same working directory; this bundle adds no worktree isolation or filesystem locking.
- **Copied preset list** — the `team` preset copies the shipped `standard` plugin list. Edits to `standard` from the Web editor do not reach `team`, and the preset's English name and description are not localized.
- **Base profile required** — the patch depends on row ids and Subagent providers supplied by `dsh-base`; it is not a standalone profile.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
