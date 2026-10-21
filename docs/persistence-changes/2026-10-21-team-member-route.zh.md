---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-21-team-member-route

[English](2026-10-21-team-member-route.md) | 中文

## 概述

为 Agent Teams 成员快照新增可选的 teammate LLM 路由，并新增携带该路由的 team/member 版本 3 payload。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-21-team-member-route
baseline: false
changes:
  - root: "event:team/member"
    previous: "2026-09-11-initial"
    after: "269e292922fac72a8eedcc9f8e8ccd56576c20cbec886f1b0728ebbd68d149dc"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

写入方仅为带路由创建的成员写入版本 3（必须有 llmProvider 和 llmModel，llmReasoningEffort 可选）；无路由成员保持不变的版本 2 payload，解码器拒绝版本 2 记录中的路由字段。当前读取方接受版本 2 和 3，因此所有现有日志按原样回放。旧读取方通过现有的不支持版本检查拒绝版本 3 记录，并记录 Team 投影失败，而不会误读路由。Team 投影缓存 stateVersion 从 4 改为 5，使携带路由字段的 checkpoint 永远不会被旧读取方的严格状态 schema 接纳。SessionHeader.version 保持不变。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/agent-team packages/experimental/tool-agent-team：5 个文件、114 个测试通过，覆盖带路由创建、无路由版本 2 写入、带路由成员重启后的列表与冷恢复、带路由的 provisioning 恢复、旧版本 2 回放、版本与路由不一致的拒绝，以及从缓存版本 4 重建 checkpoint。

<a id="dev-note"></a>
## 开发备注

无。
