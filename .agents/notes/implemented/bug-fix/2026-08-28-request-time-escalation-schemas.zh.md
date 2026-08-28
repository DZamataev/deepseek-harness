# Agent Note: 升权 schema 跟随请求的常驻策略

Status: implemented

[English](2026-08-28-request-time-escalation-schemas.md) | 中文

## Problem

执行沙箱的工具注册一份进程级升权 schema，其中同时包含 `workspace-write` 与 `danger-full-access`。执行层正确要求目标严格宽于调用会话的有效模式，但请求组装仍把完整注册枚举发送给每个模型。因此，已经处于 `danger-full-access` 的会话仍会看到 `sandbox_permissions: danger-full-access`；模型可能选择这个表面可用的选项，并在命令运行前收到 `sandbox escalation to "danger-full-access" is not strictly wider than this call's current "danger-full-access" mode`。subagent 同样遇到该错配，因为委派模式位于会话日志中，而 schema 没有读取它。

## Decision

`ToolDefinition.projectModelSchema(agent, schema)` 可以从可重建的 agent／会话状态同步投影一份已注册工具在单次请求中的描述与参数。投影后的参数可以收窄可接受输入，但绝不能接受已注册校验器会拒绝的参数对象。`ToolRuntime` 把该投影应用到原生 Function Calling schema 与生成的 PTC SDK 绑定。无 agent 的 `ctx.tools.schemas()` 与生成工具目录保留已注册回退，执行继续按该已注册定义校验。

沙箱消费方通过 `ctx.sandboxPolicy` 折叠调用会话，选择 `WIDER_MODES[effectiveMode]`，并把升权参数对一起投影。`read-only` 公布 `workspace-write | danger-full-access`；`workspace-write` 只公布 `danger-full-access`；`danger-full-access` 省略 `sandbox_permissions`、`justification`，以及指导升权的 shell 描述条款。`bash`、`pwsh`、`write` 与 `edit` 使用同一投影 helper。严格放宽的执行检查仍对注入、陈旧或非模型调用具有最终权威。

## Testing

core 工具测试证明回调不会进入无 agent 的 schema、会改变原生请求字段，并驱动生成的 PTC SDK 文本。每个沙箱消费方都为三种模式组装请求，并断言准确枚举或成对省略。录制会话 sidecar 分别固定 read-only、workspace-write 与 full-access 请求 schema。既有执行测试继续证明注入的非放宽升权不会运行任何内容，也不会打开审批提示。

## Alternatives considered

**部署默认值为 `danger-full-access` 时移除升权字段。**否决：会话可以把该默认值覆盖为 `read-only`，被委派的 subagent 也会如此，此时仍需要两个升权目标。

**保留静态枚举并依赖提示词文本。**否决：JSON schema 把无效目标呈现为可调用 API，模型行为已经表明文本不能可靠覆盖该 affordance。

**按会话或模式切换重新注册一份工具定义。**否决：各模式的执行行为一致，复制注册表条目只会增加生命周期归属与 churn。请求组装已经携带准确 agent，正是面向模型字段的归属点。

**收窄 schema 后移除严格放宽执行检查。**否决：schema 省略只是通告，不是强制执行；直接调用方、陈旧请求与未公布的开放对象属性仍能到达执行。

## Consequences

`danger-full-access` 下的普通调用不再携带升权参数或指导，因此会到达执行器，而不是作为自我升权失败。更窄的会话保留恰好可用的恢复目标。模式切换可以在下一次请求中改变工具 schema token，因此可能从变化的定义起使 KV-cache 复用失效，而已注册目录与执行校验器保持稳定。
