---
kind: upgrade-guide
description: "In Web and Desktop, Agent Teams tools move from every session to the Agent Teams preset."
---

# Agent Teams tools use a dedicated preset in Web and Desktop

English | [中文](guide.zh.md)

## Change

With the experimental `@deepseek-ai/dsh-experimental-agent-team-profile` bundle enabled, a Web or Desktop profile previously mounted the Team tools at the Host. Every session then received them next to the preset's `subagent`, `subagent_fork`, `send_message`, `list_agents`, and `interrupt_agent`, and the Team tools with the same names replaced the subagent ones.

A profile started with `@deepseek-ai/dsh-web-app` now mounts the Team tools only through a new preset with id `team`, shown as **Agent Teams**. Sessions of every other preset get no Team tools, and `standard`, `ptc`, and `cordis` sessions keep their subagent delegation. The Team roster and task board UI remain available. Headless profiles are unchanged.

Sessions created before the upgrade keep their recorded preset; a session that recorded `standard` no longer receives the Team tools when it resumes.

## Migration

1. Open the Plugins page and confirm that **Agent Teams** is still enabled.
2. Start a new session and choose **Agent Teams** in the preset picker before sending the first message. To use it for every new task, select it under Settings → Agent presets.
3. A profile patch or overlay that targeted the Host `tool-agent-team` row to change its `config` has no effect in Web or Desktop. Override the `preset-team` row instead, restating its complete `config` from the bundle's [`cordis.patch.yml`](../../../../packages/experimental/agent-team-profile/cordis.patch.yml).
4. Confirm in the new session that `spawn_teammate` is listed and `subagent` is not, and that a `standard` session lists `subagent` but not `spawn_teammate`. See the [bundle reference](../../../../packages/experimental/agent-team-profile/README.md#use-this-package).
