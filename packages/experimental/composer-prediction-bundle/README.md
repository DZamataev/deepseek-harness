---
description: "Switch on predicted next-message suggestions for the Web composer from the plugin manager."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-composer-prediction-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle adds composer prediction to a profile: the Host row predicts the next user message after each completed turn, and the Web row shows the accepted text as the composer placeholder with a Tab hint. It ships switched off; open Plugins, choose More, and switch on Composer prediction. Each completed turn can then bill one extra, mostly cached, request on the Session's own route, and the Host row skips the turns and Sessions where that request would be paid in full. Switching the bundle off removes both rows.

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

### Enable it in Plugins

Open Plugins in the Web sidebar, choose More, and switch on Composer prediction. The installation ships the package for optional selection, so it cannot be removed, only switched off; switching it off removes its rows from the running profile and keeps the package installed. Switching it back on needs no download.

### What you get

| Row | Package | Contribution |
|---|---|---|
| `composer-prediction` | [Host plugin](../composer-prediction/README.md) | Plans, sends, and records one prediction per completed turn, then publishes the `composerPrediction` projection |
| `ui-composer-prediction` | [client plugin](../client-ui-composer-prediction/README.md) | Feeds that projection into the composer suggestion seam |

The layer supplies `maxOutputTokens: 1024`, `timeoutMs: 60000`, `minAssistantMessages: 2`, and `maxUncachedTokens: 10000`. The [Host plugin](../composer-prediction/README.md#use-this-package) owns what those values mean and when a prediction is skipped.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) is the whole layer: one insert list with the Host row and its four settings, then the Client row. A later profile patch can override either row's settings by id, and the [profile composer](../../boot/app-boot/README.md) owns patch ordering and errors. The bundle's [`src/index.ts`](src/index.ts) is an empty marker because the layer carries no runtime code of its own, and [`locale/`](locale/en.json) supplies the title and one-line description the Plugins page shows.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Host prediction plugin](../composer-prediction/README.md) — the request, its skip rules, and the projection.
- [Client plugin](../client-ui-composer-prediction/README.md) — the provider that maps the projection into the composer.
- [Conversation UI](../../client/ui-conversation/README.md) — the placeholder, Tab hint, and acceptance keys.
- [Experimental package map](../README.md) — the group's optional bundles and their status.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [Host plugin](../composer-prediction/README.md), whose row owns the auxiliary request and the instruction it appends.

#### KV Cache effect

No direct effect. The Host row's replay owns cache behavior, and this layer only decides whether those rows run.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Billing scales with use** — every completed turn that passes the skip rules can add one request. Predictions replay the Session's own route, so they are mostly cached but never free.
- **No routed cheap-model path** — the bundle exposes no provider or model setting; the [Host plugin's limits](../composer-prediction/README.md#known-limitations-and-deferred-work) apply instead.
- **The icon is provisional** — the experimental glyph still needs designer approval under `dsh-official-plugin-artwork`.
- **Existing records survive switching off** — disabling stops new predictions; `plugin:composer-prediction/request` and `result` records already in a Session log stay readable.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
