---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-21-team-member-route

English | [中文](2026-10-21-team-member-route.zh.md)

## Summary

Adds an optional teammate LLM route to Agent Teams member snapshots and a version 3 team/member payload that carries it.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Writers emit version 3 only for a member created with a route (llmProvider and llmModel required, llmReasoningEffort optional); unrouted members keep the unchanged version 2 payload, and the decoder rejects route fields in a version 2 record. Current readers accept versions 2 and 3, so every existing log replays unchanged. Older readers refuse a version 3 record through the existing unsupported-version check and record a Team projection failure instead of misreading the route. The Team projection cache stateVersion moves from 4 to 5 so checkpoints carrying route fields are never admitted by an older reader's strict state schema. SessionHeader.version is unchanged.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/agent-team packages/experimental/tool-agent-team: 5 files, 114 tests passed, covering routed spawn, unrouted version 2 writes, routed restart listing and cold resume, routed provisioning recovery, legacy version 2 replay, version/route mismatch rejection, and checkpoint rebuild from cache version 4.

<a id="dev-note"></a>
## Dev Note

None.
