---
description: "在一个实验性组合包中启用团队协作、工具与 Web 成员和任务看板。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-agent-team-profile

[English](README.md) | 中文

## 概述

`dsh-experimental-agent-team-profile` 让 [Agent Teams](../agent-team/README.zh.md) 的团队协作、工具和 Web 界面通过一个组合包启用。开启后可委派 teammate，并在 Web 中查看成员、任务看板和成员会话。获得 Team 工具的 Agent 不会同时获得普通 subagent 委派，也不会获得与 Team 工具同名的全局 child control；Workflow 仍可创建 fresh 子代理。在 Web 和 Desktop 中，Team 工具属于 **Agent Teams** 预设，其他预设保留 subagent 委派。本包随 dsh 安装提供，默认关闭，可在插件页开启或添加到已初始化的 profile。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 安装到 profile

将本包添加到已初始化的 profile，然后运行一个要求 Lead 委派工作的任务：

```sh
dsh plugin --profile headless add @deepseek-ai/dsh-experimental-agent-team-profile
dsh --profile headless "Use Agent Teams to split this task between two teammates, wait, and summarize."
```

profile 必须已经包含 `@deepseek-ai/dsh-base`，本层会使用其中的 Subagent 服务与提供方配置行。执行 `dsh plugin --profile <name> remove @deepseek-ai/dsh-experimental-agent-team-profile` 移除本包时，bundle 也会从 profile 的有序层列表中移除。

在 Web 或 Desktop 的插件页开启「智能体团队」。然后在新建的空白会话中通过预设选择器选择 **Agent Teams**；也可在「设置 → Agent 预设」中将其设为新任务的默认预设。其他所有预设的会话都不会获得 Team 工具；`standard`、`ptc` 和 `cordis` 会话保留 `subagent`、`subagent_fork` 和 subagent child control。会话的预设在第一轮之后固定，需要切换时请新建会话。CLI 的 Web profile 也可使用以下命令：

```sh
dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-profile
```

已有 profile 的 `package.json` 中，`dsh.profile.bundles` 应只保留 `@deepseek-ai/dsh-experimental-agent-team-profile`，删除独立的 `@deepseek-ai/dsh-experimental-agent-team-web-profile` 条目。用户 patch 中的 `ui-agent-team` 配置仍然有效。

### 获得的功能

本层会添加 Agent Teams domain，以及 Team-scoped 创建、roster、消息、interrupt、等待与任务板工具。直接委派使用支持 fresh 和 fork 上下文的 `spawn_teammate`。拥有 Team 工具的 Agent 没有 `subagent` 或 `subagent_fork` 工具，也没有同名的全局 child control。在 headless profile 中，每个会话都是这样的 Agent；在 Web 和 Desktop 中，只有 `team` 预设的 Agent 及其 teammate 是。Workflow 保留 base profile 的 `spawn` 提供方，底层 Subagent 服务和两个提供方仍供 teammate 与 workflow 使用。

在 Web 和 Desktop 会话中，[Team UI](../client-ui-agent-team/README.zh.md) 显示成员列表与共享任务看板，并可打开成员会话。同一个组合包开关控制工具与浏览器 UI。插件页通过组合包的 `package.json.icon` 声明读取其[图标](icon.svg)，组合包禁用时也会显示。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包的运行时内容是 [`cordis.patch.yml`](cordis.patch.yml)。在 `dsh-base` 之后应用时，patch 会禁用 Host 行 `tool-subagent-control`、`tool-subagent-list-agents`、`tool-subagent` 和 `tool-subagent-fork`，并以显式 provider 和限制插入 Team 服务、工具和 UI 行。`agent-team` 服务和 `ui-agent-team` 始终挂载在 Host。UI 插件的 Host 入口不执行逻辑；只有 Web 客户端加载器会挂载其浏览器入口，因此 headless 无需启动 Web 服务。

`dsh-web-app` 自身会禁用这些 Host 委派行，并在每个 Agent Preset 的 `plugins` 中挂载委派，顶层 patch 无法定位这些行。因此有两行取决于 dsh profile 启动时是否包含 `@deepseek-ai/dsh-web-app`（`profileContext.startedBundles`）。不包含时，挂载 Host `tool-agent-team` 行，并禁用 `preset-team` 声明。包含时，禁用 Host 行，由 `preset-team` 声明 `team` 预设。该预设是 `dsh-web-app` 的 `standard` 插件列表，只是把四个委派行替换为同一个 `tool-agent-team` 行。[`tests/composition.spec.ts`](tests/composition.spec.ts) 组合随附 bundle；若副本与 `standard` 不一致、随附预设被改变，或任何 Agent 会同时挂载两类工具，测试就会失败。没有 dsh profile 的启动遵循 headless 规则。

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 叠加在 `dsh-base` 之上的有序 patch |
| [`src/index.ts`](src/index.ts) | 空模块入口；patch 是运行时内容 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [实验性包](../README.zh.md)——孵化状态与发布规则。
- [Agent Teams service](../agent-team/README.zh.md)——持久 roster 与任务板，以及直接消息行为。
- [Agent Teams 工具](../tool-agent-team/README.zh.md)——Team-scoped 模型工具表层。
- [Agent Teams 浏览器 UI](../client-ui-agent-team/README.zh.md)——成员列表、任务看板与成员会话导航。
- [Base bundle](../../bundle/base/README.zh.md)——本 patch 扩展的 profile 层。

-----

<a id="model-experience"></a>
## 模型体验

### Team 策略与工具

#### 模型会看到什么

Team 策略与 schema 由 [`@deepseek-ai/dsh-experimental-tool-agent-team`](../tool-agent-team/README.zh.md) 所有。本 bundle 只改变 composition：对拥有 Team 工具的 Agent，Team-scoped `list_agents`、`send_message` 与 `interrupt_agent` 会替代全局 continuable-child control。其他 Web 预设的 Agent 看到的是 subagent 工具，没有 Team 工具。`spawn_teammate` 是直接委派工具。Workflow 的 `agent()` 调用创建 fresh 一次性子代理；其提示词必须包含任务所需的上下文。

#### Token 影响

本 bundle 会加入 `@deepseek-ai/dsh-experimental-tool-agent-team` 描述的 Team 策略与工具 schema；它自身不增加提示词文本。

#### KV Cache 影响

只要 bundle patch 与配置的工具 schema 不变，共享 system prompt 和工具 schema 就保持前缀稳定。Team 身份通过 runtime-context 快照追加；[Team 工具](../tool-agent-team/README.zh.md#model-experience)定义快照复用方式。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅显式启用**——本包随安装提供但默认关闭；随附 CLI、Web、SDK、ACP 与 Python profile 都不会启用它。
- **Workflow 子代理工具**——[Team 工具可见性限制](../tool-agent-team/README.zh.md#known-limitations-and-deferred-work)也适用于 workflow 子代理。
- **共享 checkout**——所有 teammate 都观察同一个工作目录；本 bundle 不提供 worktree 隔离或文件系统锁。
- **复制的预设列表**——`team` 预设复制了随附的 `standard` 插件列表。通过 Web 编辑器对 `standard` 的修改不会同步到 `team`，且该预设的英文名称和描述不做本地化。
- **需要 base profile**——本 patch 依赖 `dsh-base` 提供的配置行 id 与 Subagent 提供方；它不是独立 profile。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
