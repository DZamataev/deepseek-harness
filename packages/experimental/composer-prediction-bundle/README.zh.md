---
description: "从插件管理页为 Web composer 开启下一条消息预测建议。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-composer-prediction-bundle

[English](README.md) | 中文

## 概述

此可选 Bundle 为配置加入输入预测：Host 行在每个完成的轮次后预测下一条用户消息，Web 行把通过的文本作为带 Tab 提示的 composer 占位提示显示。它默认关闭；打开插件页，选择“更多”，开启“输入预测”。此后每个完成的轮次都可能按 Session 自己的路由额外计费一次主要为缓存的请求，而 Host 行会跳过会按全价计费的路由的轮次与 Session。关闭 Bundle 会移除两行。

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

### 在插件页启用

打开 Web 侧栏的插件页，选择“更多”，开启“输入预测”。安装包已随产品提供，供可选选择，因此不能移除，只能关闭；关闭会从运行中的配置移除其行，并保留已安装的包。重新开启无需下载。

### 你会得到什么

| 行 | 包 | 贡献 |
|---|---|---|
| `composer-prediction` | [Host 插件](../composer-prediction/README.zh.md) | 为每个完成的轮次规划、发送并记录一次预测，然后发布 `composerPrediction` 投影 |
| `ui-composer-prediction` | [客户端插件](../client-ui-composer-prediction/README.zh.md) | 把该投影接入 composer 建议接缝 |

该配置层提供 `maxOutputTokens: 1024`、`timeoutMs: 60000`、`minAssistantMessages: 2` 与 `maxUncachedTokens: 10000`。[Host 插件](../composer-prediction/README.zh.md#use-this-package)负责说明这些值的含义以及何时跳过预测。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 就是整个配置层：一个插入列表，先是带四项设置的 Host 行，然后是 Client 行。后续配置补丁可以按 id 覆盖任一行的设置，[配置组合器](../../boot/app-boot/README.zh.md)负责补丁顺序与错误处理。Bundle 的 [`src/index.ts`](src/index.ts) 是空标记，因为该配置层不携带自己的运行时代码，[`locale/`](locale/en.json) 提供插件页显示的标题与单行说明。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Host 预测插件](../composer-prediction/README.zh.md)——请求、跳过规则与投影。
- [客户端插件](../client-ui-composer-prediction/README.zh.md)——把投影映射进 composer 的提供方。
- [会话 UI](../../client/ui-conversation/README.zh.md)——占位提示、Tab 提示与接受按键。
- [实验性包映射](../README.zh.md)——该分组的可选 Bundle 及其状态。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，通过 [Host 插件](../composer-prediction/README.zh.md)，由其行拥有辅助请求以及追加的指令。

#### KV Cache 影响

没有直接影响。Host 行的重放拥有缓存行为，此配置层只决定这些行是否运行。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **费用随使用增长**——每个通过跳过规则的完成轮次都可能增加一次请求。预测重放 Session 自己的路由，因此大部分命中缓存，但从不免费。
- **没有路由到廉价模型的路径**——Bundle 不提供提供方或模型设置；适用 [Host 插件的限制](../composer-prediction/README.zh.md#known-limitations-and-deferred-work)。
- **图标是临时的**——该实验性图形仍需按 `dsh-official-plugin-artwork` 获得设计者批准。
- **已有记录在关闭后保留**——禁用会停止新的预测；Session 日志中已有的 `plugin:composer-prediction/request` 与 `result` 记录仍可读取。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
