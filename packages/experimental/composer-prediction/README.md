---
description: "Next-user-message prediction from a Session's warm prefix cache, for maintainers composing, tuning, or debugging composer suggestions."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-composer-prediction

English | [中文](README.zh.md)

## Summary

After each completed turn, this plugin asks the Session's own model what the user would type next and publishes the accepted guess as a Session projection. The request replays the last routed request byte-for-byte, so a provider's prefix cache covers all but the new reply and the instruction. It runs only in ordinary Sessions, after enough assistant replies, and while the estimated uncached input stays at or under `maxUncachedTokens`. Mounting it alone issues those requests; [the client plugin](../client-ui-composer-prediction/README.md) shows the text in the composer, and [the bundle](../composer-prediction-bundle/README.md) mounts both.

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

Mount this plugin where an ordinary Session should predict its own next user message. It requires the LLM, Agent, and Session projection services plus all four settings below; the [optional bundle](../composer-prediction-bundle/README.md) supplies working values.

### When predictions run

A prediction is planned when a `turn/end` whose reason is `completed` commits for a Session whose origin is not `subagent`. The plan replays the Session's derived surface messages, the logged request configuration with `maxTokens` replaced by `maxOutputTokens`, the logged tools, and the tool history, appends the instruction below, and dispatches one `ctx.llm.stream` call with `purpose: 'composer-prediction'` on the Session's own provider and model. It makes exactly one attempt and has no retry.

A completed turn is skipped when the Session has no logged routed request, holds fewer than `minAssistantMessages` assistant messages, ends on a message that is not an assistant reply, ends on a reply that carries a tool call, reports no usage for that reply, or estimates more uncached input than `maxUncachedTokens`. The estimate charges the previous reply's output tokens when the provider reported cache reads, and the whole prompt when it reported none, so a provider that never reports cache reads is treated as not caching.

One prediction runs per Session at a time. A new `turn/start`, a user message inserted into the inbox, disposal of the Agent, or unloading the plugin aborts the in-flight request, and an aborted request appends no result. The projection holds a suggestion only for the latest started turn; a newer turn, a user message, or a non-empty inbox insertion withdraws it.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxOutputTokens` | required | Output-token cap of one prediction request, reasoning included. |
| `timeoutMs` | required | End-to-end deadline of one prediction request in milliseconds. |
| `minAssistantMessages` | required | Assistant replies required before the first prediction. |
| `maxUncachedTokens` | required | Largest estimated full-price input a prediction may replay. |

Every field is required and none has a default; the bundle sets 1024, 60000, 2, and 10000. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-composer-prediction) is the exhaustive source for every accepted field.

### Failures and recovery

Each dispatched prediction appends a request record before it is sent and one result record after it returns, and no outcome reaches a user as an error. An accepted reply carries its text, a reply that fails the output filter records the first failed rule, `NONE` records `abstained`, and a tool call, an output-cap finish, a transport failure, or a timeout records `failed` with its finish kind, failure code, or error name. A record the Session refuses is reported through `ctx.logger` and drops only that prediction. The next completed turn is the only retry.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the plugin's design; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

Everything is decided at the committed `turn/end` and frozen, so the replay is exactly the conversation that turn closed; nothing is re-derived after the first `await`. The output filter is a port of the Hermes `tui_gateway/suggest_predict.py` rules with Unicode-aware boundaries and Python-compatible code-point lengths.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: validated `Config`, projection registration, and scheduler start |
| [`src/plan.ts`](src/plan.ts) | Send-or-skip decision, the uncached-input estimate, and the frozen request |
| [`src/runner.ts`](src/runner.ts) | Post-turn scheduling, cancellation, the model call, record appends, and outcome interpretation |
| [`src/filter.ts`](src/filter.ts) | Acceptance rules: word count, length, meta text, placeholders, praise, and assistant voice |
| [`src/instruction.ts`](src/instruction.ts) | The exact instruction appended after the replayed conversation |
| [`src/projection.ts`](src/projection.ts) | `composerPrediction` fold over turns, user messages, inbox insertions, and result records |
| [`src/types.ts`](src/types.ts) | Records, outcomes, projection state, and the module declarations that register them |

### Scheduling

The scheduler listens to the `session/event` feed. A `turn/start` cancels the Session's in-flight request and forgets its recorded usage, an `assistant/message` replaces that usage, and a completed `turn/end` plans the request and appends its record in a queued microtask because a Session cannot grow while that event still publishes. The result record anchors on the request record's seq, and the projection publishes `{ turn, text }` or null through the Session projection wire, so a reloaded page and a second client see the same suggestion.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package contract is not enough. They move from the composer the suggestion feeds to the technique it shares.

- [Composer suggestion seam](../../client/ui-conversation/README.md) — the registry, placeholder, and Tab acceptance that display a suggestion.
- [Client plugin](../client-ui-composer-prediction/README.md) — the provider that maps this projection into the composer.
- [Optional bundle](../composer-prediction-bundle/README.md) — the Plugins entry that mounts both packages.
- [Compaction backend](../../compaction/compaction-basic/README.md) — the same byte-for-byte replay of a warm prefix for an auxiliary request.
- [LLM streaming subsystem](../../../docs/subsystems/llm-streaming.md) — `GenerateOptions`, stream chunks, and request attribution.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-composer-prediction) — every accepted field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Composer prediction request

#### What the model sees

The prediction model receives the Session's derived surface messages, which end with the assistant reply that closed the turn, followed by the instruction below as a final user message. The logged tools and the tool history travel with the replay, so the conversation reads as the request that produced that reply. It answers with the next user message it expects, or with `NONE` to stay silent.

##### Prediction instruction (final user message)

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

#### Token effect

One auxiliary request may follow each completed turn that passes the skip rules, capped by `maxOutputTokens` including provider-counted reasoning. Its input is the replayed conversation plus one instruction; the main conversation gains no message, so its next request keeps its own tokens. A skipped turn sends no request, and a cancellation before dispatch sends none either; a cancellation after dispatch aborts the in-flight stream, so the provider may already have received and billed that input, and the superseded result is never recorded. A request that fails after the provider started replying is still billed.

#### KV Cache effect

The main request is never invalidated, and the replay reaches the provider as the last routed request's prefix followed by that request's reply, so a caching provider reuses the prefix and charges only the reply and the instruction as new input. Reuse ends at the first differing token: a request-derivation change or a tool-declaration change since the logged request moves that boundary, and the replay is then paid in full. The `maxUncachedTokens` guard reads the previous reply's reported usage, so it cannot see a divergence that only the provider's answer reveals, and a provider that reports no cache reads is treated as not caching.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints bound what a suggestion can cost and when one appears.

- **No routed cheap-model path** — a prediction always replays on the Session's own provider and model. A short request on a separate cheap route would lose the prefix cache, so no route setting exists; one can be added later behind explicit configuration.
- **Providers that report no usage never predict** — the cold-cache guard needs the last assistant message's usage, so a route that reports none skips every turn.
- **The cold-cache guard is an estimate** — `maxUncachedTokens` compares the previous reply's reported usage, so a provider that miscounts cache reads, or a prefix that changed since the logged request, can still produce a replay paid in full.
- **One prediction per Session at a time** — a new completed turn cancels the previous in-flight prediction, and only the latest started turn can hold a suggestion.
- **A forked Session can show its parent's suggestion** — a fork refolds the records it inherited, so it can publish the parent's latest accepted text until its own next turn starts.
- **Silence phrases use ASCII word boundaries** — the Hermes port matches the English phrases `silence is` and `stay silent` (also `stays silent` and `staying silent`) through `\b`, which JavaScript reads as ASCII-only, so a phrase touching a non-ASCII letter, such as `éstay silenté`, still matches; that text is treated as meta silence and rejected, where Hermes and its Unicode word boundaries would accept it.
- **The Tab hint carries the whole suggestion** — the hint's accessible name and the editor's description both include the complete predicted text, so a screen reader reads the suggestion when it reaches either.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
