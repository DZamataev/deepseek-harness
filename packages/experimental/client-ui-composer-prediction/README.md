---
description: "Show the predicted next user message as the composer placeholder through the conversation suggestion seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-composer-prediction

English | [中文](README.zh.md)

## Summary

This optional browser plugin turns the Host `composerPrediction` projection into the composer's placeholder suggestion. It registers the single provider that `ctx.conversation.suggestions` accepts, resolves one identity-stable source per Session, and reports no text where a Session has no prediction. The placeholder, the Tab hint, and Tab or Right-arrow acceptance belong to [the conversation UI](../../client/ui-conversation/README.md), which this plugin does not modify. Without [the Host prediction plugin](../composer-prediction/README.md) the projection is absent, so every Session resolves to no suggestion.

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

Enable [the optional bundle](../composer-prediction-bundle/README.md) in Plugins, which mounts this row beside the Host plugin. A Web composition that already mounts the conversation UI and the Host plugin can mount this row directly.

### What appears in the composer

When a Session's latest completed turn accepted a prediction, the composer shows that text as ghost placeholder text with a trailing Tab key hint. Clicking the hint, or pressing Tab or Right arrow in the focused empty editor, writes the text into the draft without sending. Typing hides it, clearing the draft shows it again, and the next turn replaces or withdraws it. Every one of those rules belongs to the conversation UI; this plugin only supplies the text.

### Failure behavior

The seam accepts one provider, so loading this plugin beside another suggestion provider fails instead of replacing it. A Session with no live binding, or with no `composerPrediction` projection, gets an empty source rather than an error. The registration follows the Client plugin lifetime: re-attaching registers again, and disposal withdraws the provider.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider reads one Session's projection face through `ctx.sessions.binding(sessionId)` and caches one source per Session keyed by that face. The cached source is returned while the face identity is unchanged, so a React store reading it does not resubscribe on unrelated updates, and a replaced generation re-subscribes to its new face.

A local guard narrows the wire value to a finite `turn` and a non-empty `text` before any text reaches the composer, so a projection written by a newer Host build cannot place an unusable placeholder. Sessions without a binding or without the projection share one empty source, which keeps its identity across repeated requests. The registration and the cache live in one `ctx.effect`, so disposal withdraws the provider and releases every cached face reference.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Host prediction plugin](../composer-prediction/README.md) — the request, records, and projection this row reads.
- [Optional bundle](../composer-prediction-bundle/README.md) — the Plugins entry that mounts both rows.
- [Conversation UI](../../client/ui-conversation/README.md) — the suggestion registry, placeholder precedence, and keyboard acceptance.
- [Session projection service](../../session/session-projection/README.md) — how a projection reaches a browser as an observable face.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [Host prediction plugin](../composer-prediction/README.md), which owns the auxiliary request and the instruction it appends.

#### KV Cache effect

No direct effect. The Host plugin owns the replayed request and its cache behavior, and the suggestion text this plugin supplies is never sent to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Requires the Host plugin** — without a `composerPrediction` projection every Session resolves to no suggestion, and the composer keeps its own placeholders.
- **Only accepted predictions appear** — rejected, abstained, and failed outcomes are recorded in the Session and never displayed.
- **The text is shown as published** — this plugin neither re-runs the output filter nor shortens the text; a stored suggestion that a later filter version would reject still appears.
- **A forked Session can show its parent's text** — the source follows whatever the Host fold publishes, so a fork can show the parent's latest accepted suggestion until its own next turn starts.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
