# Agent Note: Composer prediction

Status: proposed

English | [中文](2026-10-20-composer-prediction.zh.md)

## Problem

After an agent reply, the user's next message is often predictable: "run the tests", "commit this", "yes, go ahead". Typing it costs time, and the Web composer offers nothing until the user starts typing. Hermes ships this as a composer ghost: when a turn completes, the agent's own model guesses the next user message from the warm prompt cache, the empty composer shows the guess as ghost text, and Tab or Right arrow accepts it into the draft without sending it.

DSH has no equivalent, and the composer has no extension point for one. The resident composer in `dsh-client-ui-conversation` composes its placeholder internally and routes Tab through the trigger-menu keymap only. A plugin can write the draft through `inputActions.setDraft`, but it cannot show a suggestion in an empty composer or claim Tab and Right arrow for it.

## Proposal

The feature ships as an opt-in experimental bundle over one new product seam. The seam is neutral: it knows a composer suggestion, not a model prediction.

### Host plugin: `@deepseek-ai/dsh-experimental-composer-prediction`

**Trigger.** The plugin observes the post-commit `session/event` feed. After a `turn/end` whose reason is `completed`, it schedules one prediction for that turn. It skips subagent Sessions, conversations with fewer than `minAssistantMessages` assistant messages, a turn whose last assistant message carries tool calls, and a turn whose last request read too little from the provider cache: when the estimated uncached input of the last `assistant/message` usage exceeds `maxUncachedTokens`, a replay would be billed at full price.

**Request.** The request reuses the provider's warm prefix cache in the same way as the default compaction summarizer: it replays the system head at surface node 0, the surface messages, the latest `request/header` tools, and `Session.toolHistory()` byte-for-byte on the Session's own provider and model, then appends one user message carrying the prediction instruction. The instruction asks for the next message the user would type, in the user's language and style, 2 to 12 words, never in the assistant's voice, and `NONE` when the next step is not obvious. The call sets `purpose: 'composer-prediction'` and caps output at `maxOutputTokens`. It makes exactly one attempt. A tool call, a `max-tokens` finish, an error, or an abort yields no suggestion.

**Cancellation.** A new `turn/start`, a user message inserted into the inbox, or plugin disposal aborts the in-flight request through its `AbortSignal`. A result that arrives after its turn was superseded is never recorded.

**Output filter.** A port of the Hermes `reject_reason` and `_clean` rules accepts a reply only when it is 2 to 12 words and under 100 characters after unwrapping labels, role prefixes, quotes, and wrapper tags. It rejects `NONE`, meta text about silence, error text, fill-in placeholders, multiple sentences, formatting, praise or thanks, and assistant-voice openings. The rules cover English, Russian, and unspaced CJK scripts.

**Session log.** Two experimental plugin records, appended through `appendPluginRecord`, keep the auxiliary request reconstructable without a Session format change:

- `plugin:composer-prediction/request`, before dispatch: the instruction text, provider, model, `maxTokens`, and the last replayed event seq.
- `plugin:composer-prediction/result`, after the reply: `{ requestSeq, turn, text | null }` and the reported usage.

**Projection.** A `composerPrediction` unit on `ctx.sessionProjections` folds the log into `{ turn, text } | null`. A result record with text sets it; `turn/start` and a new user message clear it. Clients receive the value through the existing projection carriers, so it survives reload and reconnect and every client sees the same value.

**Configuration.** `maxOutputTokens`, `timeoutMs`, `minAssistantMessages`, and `maxUncachedTokens` are validated `Config` fields settable from `cordis.yml`.

### Product seam: composer suggestion in `dsh-client-ui-conversation`

A Client service accepts one suggestion provider, which supplies an observable `string | undefined` suggestion for each Session. A second concurrent provider registration throws. Registration returns its disposer and goes through `ctx.effect`. The exact registration form, a root-scope provider resolving per Session or a per-Session-scope registration, is settled against the Client scope API during planning.

**Visibility.** The suggestion is a placeholder, never draft text. The composer shows it when the draft is empty, no attachment or command chip is present, the Session is not running, and no `/` or `@` menu is open. The suggestion outranks the default and plan placeholders. Owner-supplied placeholders (Hero, unavailable, parent offline) and the steer-queue hint outrank the suggestion. Typing hides it, and clearing the draft shows it again; the next completed turn replaces or clears it. The composer offers no dismissal: typing a different message is the way to ignore it.

**Presentation.** The suggestion renders in the placeholder position with ghost styling and a trailing locale-owned "Tab" key hint. Clicking or tapping the hint accepts the suggestion, so touch devices without a Tab key can accept it. The editor references the suggestion and its key hint through `aria-describedby`.

**Keys.** Acceptance keys act only while the composer editor has focus; the keymap registers them as Lexical editor commands, which the editor dispatches only for its own focused root. They run after trigger-menu arbitration passes:

- Plain Tab or Right arrow, outside IME composition, while the live editor document is empty and a suggestion is visible, writes the suggestion text through `setDraft` with the caret at its end. It never submits. The emptiness check reads the Lexical document rather than React state, so a character typed in the same frame is never replaced. Without a visible suggestion, Tab keeps its native focus traversal.
- Shift+Tab, modified Right arrow, and Escape keep their current behavior.

Without a provider, the composer behaves exactly as it does now.

### Client plugin and bundle

`@deepseek-ai/dsh-experimental-client-ui-composer-prediction` registers the provider and maps each Session's `composerPrediction` projection to its text. It owns no other UI.

`@deepseek-ai/dsh-experimental-composer-prediction-bundle` inserts the Host and Client rows, ships localized metadata, an official experimental icon reviewed under `dsh-official-plugin-artwork`, and a README. An example composition lives at `apps/cli/config/examples/composer-prediction/cordis.yml`. The default product composes only the seam, which stays inert without a provider.

### Documentation

Each new package README carries a Model Experience section: what the prediction model sees, its token cost, its KV cache effect, and that it adds nothing to the main conversation's requests. The `dsh-client-ui-conversation` README and JSDoc document the suggestion seam. Generated catalogs are refreshed.

## Alternatives considered

**A separate cheap model over a short transcript.** Hermes uses this path when the prediction task routes to another provider or model. A cold request on every turn loses the warm prefix and sees only the last few messages, so predictions are both less informed and not cheaper per useful token on DeepSeek's prefix cache. A routed path can be added later behind explicit `provider`/`model` configuration if a consumer needs it; supporting both now doubles the request code and tests.

**Host memory plus a Remote read, as Hermes `complete.suggest` does.** The prediction would vanish on restart, and the auxiliary request would still have to be logged to keep model-visible input reconstructable. It would also need a new Remote namespace and a push or poll channel, which session projections already provide.

**A Session event in `SessionEventMap`.** A released event type commits to a durable schema and migration obligations for a decorative experimental value. Plugin records are designated for experimental plugin-owned state that its owner can lose without changing how the rest of the log is interpreted.

**Default-on product feature with a settings switch.** Hermes enables predictions by default. Every completed turn bills one extra, mostly cached, request, and the prediction quality on DSH is unmeasured. Promotion from the experimental group can follow evidence.

**A slot whose component publishes the suggestion.** Slot occupants render React components; Tab acceptance needs the suggestion text synchronously inside the keymap. A component that only publishes data through an effect would hide a data provider behind rendering and lag the keymap by a commit.

## Acceptance criteria

- With the bundle enabled, after a second completed assistant reply in an ordinary Session, the log contains a `plugin:composer-prediction/request` record and a matching `result` record, and the replayed request is a byte-for-byte prefix of the last routed request followed by the instruction.
- The empty composer shows the accepted prediction as a placeholder with a Tab hint; with the editor focused, Tab and Right arrow put it into the draft without sending, and clicking the hint does the same; typing hides it and clearing the draft shows it again until the next turn.
- A new turn aborts an in-flight prediction and no result is recorded for the superseded turn; skipped cases append no records.
- Without the bundle, composer behavior, Tab traversal, and placeholders are unchanged.
- Tests: unit tests for the output filter, skip rules, and projection fold; a real-composition test booting a test `cordis.yml` through the Loader with only the LLM adapter mocked; HMR-safety disposal tests for the provider and projection registrations; Client tests for accept, the unfocused editor, same-frame typing, reappearance, IME, open menus, and the provider-absent path; a keyless recorded-session snapshot of the auxiliary request.

## Risks

- **Billing.** Each completed turn may issue one extra request. The cold-cache guard and the early-conversation skip bound the cost, but a provider that reports no cache usage makes the guard an estimate.
- **Cache parity drift.** If the replay differs from the last routed request, for example because of in-history system updates or tool-declaration changes, the request misses the cache and is billed in full. The replay reuses the compaction summarizer's reconstruction to limit divergence.
- **Prediction quality.** A wrong guess costs nothing: typing replaces it, and an unsafe guess is never sent automatically. The filter and the `NONE` instruction prefer silence.
- **Tab ownership.** Claiming Tab in an empty composer removes forward focus traversal from the editor only while a suggestion is visible; keyboard users still leave with Shift+Tab.
