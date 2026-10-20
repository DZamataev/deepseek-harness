---
description: "从 Session 的温热前缀缓存预测用户的下一条消息，供组合、调整或排查输入建议的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-composer-prediction

[English](README.md) | 中文

## 概述

每个完成的轮次结束后，此插件让 Session 自己的模型猜测用户接下来会输入什么，并把通过校验的猜测发布为 Session 投影。请求会逐字节重放上一次已路由的请求，因此提供方的前缀缓存能覆盖除新回复与追加指令之外的全部内容。它只在普通 Session、助手回复足够多、且重放不会按全价计费时运行。单独挂载它只会发出这些请求；[客户端插件](../client-ui-composer-prediction/README.zh.md) 负责在 composer 中显示文本，[Bundle](../composer-prediction-bundle/README.zh.md) 同时挂载两者。

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

在普通 Session 需要预测自己下一条用户消息的地方挂载此插件。它需要 LLM、Agent 与 Session 投影服务，以及下面四项设置；[可选 Bundle](../composer-prediction-bundle/README.zh.md) 提供了可直接使用的取值。

### 预测运行时机

当 reason 为 `completed` 的 `turn/end` 在一个 origin 不是 `subagent` 的 Session 中提交时，插件会规划一次预测。规划会重放该 Session 派生的表层消息、把 `maxTokens` 替换为 `maxOutputTokens` 的已记录请求配置、已记录的工具以及工具历史，追加下面的指令，并用 `purpose: 'composer-prediction'` 在 Session 自己的提供方与模型上发出一次 `ctx.llm.stream` 调用。它只尝试一次，没有重试。

以下情况会跳过已完成的轮次：Session 没有已记录的路由请求、助手消息少于 `minAssistantMessages` 条、最后一条消息不是助手回复、最后一条回复带有工具调用、该回复没有报告用量，或估算的未缓存输入超过 `maxUncachedTokens`。当提供方报告了缓存读取时，估算只计上一条回复的输出 token；没有报告时则计整个提示词，因此从不报告缓存读取的提供方会被视为不做缓存。

每个 Session 同时只运行一次预测。新的 `turn/start`、插入收件箱的用户消息、Agent 释放或插件卸载都会中止在途请求，被中止的请求不会追加结果。投影只保留最新已开始轮次的建议；更新的轮次、用户消息或非空的收件箱插入都会撤回它。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxOutputTokens` | 必填 | 单次预测请求的输出 token 上限，包含推理内容。 |
| `timeoutMs` | 必填 | 单次预测请求的端到端时限，单位为毫秒。 |
| `minAssistantMessages` | 必填 | 首次预测前所需的助手回复条数。 |
| `maxUncachedTokens` | 必填 | 一次预测可重放的、估算按全价计费的最大输入。 |

所有字段均为必填且没有默认值；Bundle 设置为 1024、60000、2 与 10000。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-composer-prediction)是每个受支持字段的穷尽式真源。

### 失败与恢复

每次派发的预测都会在发送前追加一条请求记录，并在返回后追加一条结果记录，任何结果都不会以错误形式呈现给用户。通过校验的回复携带其文本，未通过输出过滤的回复记录第一条失败规则，`NONE` 记录为 `abstained`，工具调用、输出上限结束、传输失败或超时记录为 `failed` 并带上结束类型、失败码或错误名。Session 拒绝的记录通过 `ctx.logger` 报告，只丢弃该次预测。下一个完成的轮次是唯一的重试。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释插件的设计；可观察行为已在[使用此包](#use-this-package)中完整说明。

### 设计理念

一切都在提交的 `turn/end` 上决定并冻结，因此重放正好是该轮次结束时的对话；第一个 `await` 之后不再重新派生任何内容。输出过滤器是 Hermes `tui_gateway/suggest_predict.py` 规则的移植，使用 Unicode 感知的词边界和与 Python 一致的码点长度。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：校验后的 `Config`、投影注册与调度器启动 |
| [`src/plan.ts`](src/plan.ts) | 发送或跳过的判定、未缓存输入估算与冻结的请求 |
| [`src/runner.ts`](src/runner.ts) | 轮次后调度、取消、模型调用、记录追加与结果解读 |
| [`src/filter.ts`](src/filter.ts) | 接受规则：词数、长度、元文本、占位符、赞扬与助手口吻 |
| [`src/instruction.ts`](src/instruction.ts) | 在重放对话之后追加的确切指令 |
| [`src/projection.ts`](src/projection.ts) | 针对轮次、用户消息、收件箱插入与结果记录的 `composerPrediction` 折叠 |
| [`src/types.ts`](src/types.ts) | 记录、结果、投影状态以及注册它们的模块声明 |

### 调度

调度器监听 `session/event` 事件流。`turn/start` 会取消该 Session 的在途请求并忘记已记录的用量，`assistant/message` 会替换该用量，完成的 `turn/end` 会规划请求并在排队的微任务中追加其记录，因为该事件仍在发布时 Session 不能增长。结果记录以请求记录的 seq 为锚点，投影通过 Session 投影传输发布 `{ turn, text }` 或 null，因此重新加载的页面和第二个客户端会看到同一条建议。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从建议所服务的 composer 逐步进入与之共享的技术。

- [Composer 建议接缝](../../client/ui-conversation/README.zh.md)——展示建议所需的注册表、占位提示与 Tab 接受。
- [客户端插件](../client-ui-composer-prediction/README.zh.md)——把该投影映射进 composer 的提供方。
- [可选 Bundle](../composer-prediction-bundle/README.zh.md)——在插件页同时挂载两个包的条目。
- [压缩后端](../../compaction/compaction-basic/README.zh.md)——对辅助请求采用相同的温热前缀逐字节重放。
- [LLM 流式子系统](../../../docs/subsystems/llm-streaming.zh.md)——`GenerateOptions`、流式分片与请求归因。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-composer-prediction)——每个受支持字段及其来源声明。

-----

<a id="model-experience"></a>
## 模型体验

### 输入预测请求

#### 模型看到什么

预测模型会收到该 Session 派生的表层消息，其末尾是结束该轮次的助手回复，随后是下面作为最后一条用户消息的指令。已记录的工具与工具历史随重放一起发送，因此对话读起来就是产生该回复的那次请求。它用预期中的下一条用户消息作答，或用 `NONE` 保持沉默。

##### 预测指令（最后一条用户消息）

```markdown
[Composer prediction request from the app, not a message from the user. Do not answer the user, continue the task, or call tools.]

Predict what the USER would type next, not what you think they should do. The test: would they think "I was just about to type that"?

Start from the user's original request and their recent messages.
- They asked for several steps and one is done: the next step ("run the tests").
- Code was just written: "try it out".
- The assistant offered options: the one this user would pick, judging by the conversation.
- The assistant asked whether to continue: "yes" or "go ahead".
- The task is complete with an obvious follow-up: "commit this", "push it".
- After an error or a misunderstanding: stay silent, they need to assess it themselves.
Be specific: "run the tests" beats "continue".

Never suggest: praise or thanks ("looks good"), a question, anything in the assistant's voice ("Let me...", "I'll...", "Here's..."), a new idea the user did not ask about, or more than one sentence. Stay silent when the next step is not obvious from what the user said, or when the suggestion could be unsafe or touches credentials, private data, or security incidents.

Format: 2-12 words in the user's own language and style. Output only the message text: no role label, no quotes, no explanation. To stay silent, output exactly NONE.
```

#### Token 影响

每个通过跳过规则的完成轮次之后都可能发出一次辅助请求，其上限为 `maxOutputTokens`，包含提供方计入的推理内容。它的输入是重放的对话外加一条指令；主对话不增加任何消息，因此其下一次请求保持自己的 token 数。被跳过或被中止的轮次不发送任何内容，而提供方开始回复后才失败的请求仍会计费。

#### KV Cache 影响

主请求永远不会失效，重放以最后一次已路由请求的前缀加上该请求的回复到达提供方，因此支持缓存的提供方会复用前缀，只把该回复与指令作为新输入计费。复用从第一个不同的 token 起结束：自记录请求以来请求派生逻辑或工具声明发生变化都会移动该边界，此时重放按全价计费。`maxUncachedTokens` 守卫读取上一条回复报告的用量，因此无法发现只有提供方答复才能揭示的偏差，而从不报告缓存读取的提供方会被视为不做缓存。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下约束界定了建议的成本与出现时机。

- **没有路由到廉价模型的路径**——预测始终在 Session 自己的提供方与模型上重放。在独立的廉价路由上发送短请求会失去前缀缓存，因此不存在路由设置；日后可在显式配置后加入。
- **不报告用量的提供方永远不会预测**——冷缓存守卫需要最后一条助手消息的用量，因此不报告用量的路由会跳过每个轮次。
- **冷缓存守卫只是估算**——`maxUncachedTokens` 比较上一条回复报告的用量，因此计错缓存读取的提供方，或自记录请求以来发生变化的前缀，仍可能产生按全价计费的重放。
- **每个 Session 同时只有一次预测**——新的完成轮次会取消先前的在途预测，只有最新已开始的轮次能保留建议。
- **分叉的 Session 可能显示父级建议**——分叉会重新折叠它继承的记录，因此在自己下一个轮次开始前可能发布父级最新的已接受文本。
- **沉默短语保留 ASCII 词边界**——Hermes 移植版用 `\b` 匹配若干英文沉默短语，而 JavaScript 将其视为仅 ASCII，因此紧贴非 ASCII 字母的此类短语不会被识别为沉默。
- **Tab 提示携带整条建议**——提示的无障碍名称与编辑器的描述都包含完整的预测文本，因此屏幕阅读器移到任一控件时都会读出该建议。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
