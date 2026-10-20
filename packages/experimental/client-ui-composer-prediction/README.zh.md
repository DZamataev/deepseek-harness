---
description: "通过会话建议接缝，把预测的下一条用户消息显示为 composer 占位提示。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-composer-prediction

[English](README.md) | 中文

## 概述

此可选浏览器插件把 Host 的 `composerPrediction` 投影转换为 composer 的占位建议。它注册 `ctx.conversation.suggestions` 唯一接受的提供方，为每个 Session 解析同一个身份稳定的数据源，并在 Session 没有预测时报告无文本。占位提示、Tab 提示以及 Tab 或右方向键接受都属于[会话 UI](../../client/ui-conversation/README.zh.md)，此插件不修改它。没有 [Host 预测插件](../composer-prediction/README.zh.md)时投影不存在，因此每个 Session 都解析为无建议。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在插件页启用[可选 Bundle](../composer-prediction-bundle/README.zh.md)，它会把本行与 Host 插件一起挂载。已经挂载会话 UI 与 Host 插件的 Web 组合也可以直接挂载本行。

### composer 中的表现

当 Session 最新完成的轮次接受了一条预测时，composer 会把该文本显示为幽灵占位提示，并在末尾带一个 Tab 按键提示。点击该提示，或在聚焦的空编辑器中按 Tab 或右方向键，会把文本写入草稿而不发送。输入会隐藏它，清空草稿会重新显示，下一个轮次会替换或撤回它。这些规则全部属于会话 UI；此插件只提供文本。

### 失败行为

该接缝只接受一个提供方，因此与另一个建议提供方一起加载此插件会失败，而不是替换它。没有活动绑定或没有 `composerPrediction` 投影的 Session 得到空数据源，而不是错误。注册跟随 Client 插件生命周期：重新附加会再次注册，释放会撤回提供方。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

提供方通过 `ctx.sessions.binding(sessionId)` 读取单个 Session 的投影面，并把映射后的数据源按该面对象缓存在注册 effect 拥有的 `WeakMap` 中。当面身份未变时返回缓存的数据源，因此读取它的 React store 不会因无关更新而重新订阅，而被替换的世代会重新订阅它的新面。缓存与注册都不保留以 SessionId 为键的条目：已关闭的 Session 一旦丢弃其投影面，这里就不会再让该面或其投影存储保持可达。

本地守卫会把线上值收窄为有限的 `turn` 与非空的 `text`，之后文本才会到达 composer，因此由更新版本 Host 写入的投影无法放置不可用的占位提示。没有绑定或没有投影的 Session 共享一个空数据源，它在重复请求之间保持身份不变。注册与缓存位于同一个 `ctx.effect` 中，因此释放会撤回提供方，其保留的面随之可被回收。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Host 预测插件](../composer-prediction/README.zh.md)——本行读取的请求、记录与投影。
- [可选 Bundle](../composer-prediction-bundle/README.zh.md)——同时挂载两行的插件页条目。
- [会话 UI](../../client/ui-conversation/README.zh.md)——建议注册表、占位提示优先级与键盘接受。
- [Session 投影服务](../../session/session-projection/README.zh.md)——投影如何以可观察面的形式到达浏览器。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，通过 [Host 预测插件](../composer-prediction/README.zh.md)，由它拥有辅助请求以及追加的指令。

#### KV Cache 影响

没有直接影响。Host 插件拥有重放的请求及其缓存行为，此插件提供的建议文本永远不会发送给模型。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **依赖 Host 插件**——没有 `composerPrediction` 投影时每个 Session 都解析为无建议，composer 保留自己的占位提示。
- **只显示已接受的预测**——被拒绝、保持沉默与失败的结果记录在 Session 中，但从不显示。
- **文本按发布内容显示**——此插件不会重新运行输出过滤器，也不会缩短文本；日后过滤器版本会拒绝的已存建议仍会显示。
- **分叉的 Session 可能显示父级文本**——数据源跟随 Host 折叠发布的内容，因此分叉在自己下一个轮次开始前可能显示父级最新的已接受建议。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
