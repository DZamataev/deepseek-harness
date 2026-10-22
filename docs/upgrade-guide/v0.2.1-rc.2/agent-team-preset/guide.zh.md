---
kind: upgrade-guide
description: "在 Web 和 Desktop 中，Agent Teams 工具从所有会话移到 Agent Teams 预设。"
---

# Web 和 Desktop 中 Agent Teams 工具使用专用预设

[English](guide.md) | 中文

## 变更

启用实验性组合包 `@deepseek-ai/dsh-experimental-agent-team-profile` 后，Web 或 Desktop profile 以前会在 Host 挂载 Team 工具。每个会话都会同时获得这些工具和预设中的 `subagent`、`subagent_fork`、`send_message`、`list_agents` 与 `interrupt_agent`，同名的 Team 工具会替换 subagent 工具。

以 `@deepseek-ai/dsh-web-app` 启动的 profile 现在只通过一个 id 为 `team`、显示为 **Agent Teams** 的新预设挂载 Team 工具。其他所有预设的会话都不会获得 Team 工具，Standard、PTC 和 Cordis 预设的会话保留其 subagent 委派。Team 成员列表和任务看板 UI 仍然可用。headless profile 不受影响。

升级前创建的会话保留其记录的预设；记录为 `standard` 的会话恢复后不再获得 Team 工具。

## 迁移

1. 打开插件页，确认 **Agent Teams** 仍处于开启状态。
2. 新建会话，并在发送第一条消息前通过预设选择器选择 **Agent Teams**。若要让每个新任务都使用它，请在「设置 → Agent 预设」中选择它。
3. 若 profile patch 或覆盖配置曾定位 Host `tool-agent-team` 行以修改其 `config`，这些修改在 Web 和 Desktop 中不再生效。请改为覆盖 `preset-team` 行，并按组合包的 [`cordis.patch.yml`](../../../../packages/experimental/agent-team-profile/cordis.patch.yml) 重写其完整 `config`。不支持覆盖 Host `tool-agent-team` 行的 `disabled`：这会让 Host 再次挂载 Team 工具，使每个会话在其预设的 subagent 工具之外同时获得 Team 工具。
4. 在新会话中确认列出了 `spawn_teammate` 而没有 `subagent`，并确认 `standard` 会话列出 `subagent` 而没有 `spawn_teammate`。参见[组合包参考](../../../../packages/experimental/agent-team-profile/README.zh.md#use-this-package)。
