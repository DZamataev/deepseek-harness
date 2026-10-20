# Agent Note: Composer prediction

Status: implemented

English | [中文](2026-10-20-composer-prediction.zh.md)

## Problem

After an agent reply, the user's next message is often predictable: "run the tests", "commit this", "yes, go ahead". Typing it costs time, and the Web composer offers nothing until the user starts typing. Hermes ships this as a composer ghost: when a turn completes, the agent's own model guesses the next user message from the warm prompt cache, the empty composer shows the guess as ghost text, and Tab or Right arrow accepts it into the draft without sending it.

DSH otherwise has no equivalent, and the composer has no other extension point for one. The resident composer in `dsh-client-ui-conversation` composes its placeholder internally and routes Tab through the trigger-menu keymap only. A plugin can write the draft through `inputActions.setDraft`, but it cannot show a suggestion in an empty composer or claim Tab and Right arrow for it.

## Decision

Composer prediction ships as an opt-in experimental bundle over one new product seam. The seam is neutral: it knows a composer suggestion, not a model prediction.

### Host plugin: `@deepseek-ai/dsh-experimental-composer-prediction`

**Trigger.** The plugin observes the post-commit `session/event` feed. After a `turn/end` whose reason is `completed`, it plans one prediction for that turn. It skips subagent Sessions, conversations with fewer than `minAssistantMessages` assistant messages, a turn whose last message is not an assistant reply or carries tool calls, a turn whose last assistant message reported no usage, and a turn whose estimated uncached input exceeds `maxUncachedTokens`. That estimate reads the last `assistant/message` usage — its output tokens when it reported cache reads, the whole prompt when it reported none — so the ceiling bounds an estimate, not the provider's bill: a cold request below it is still sent.

**Request.** The request reuses the provider's warm prefix cache the way the default compaction summarizer does: it replays the Session's derived messages, which begin with the system head at surface node 0, the logged `requestHeader().config` with `maxTokens` replaced by `maxOutputTokens`, the logged tools, and `Session.toolHistory()` byte-for-byte on the Session's own provider and model, then appends one user message carrying the prediction instruction. The instruction asks for the next message the user would type, in the user's language and style, 2 to 12 words, never in the assistant's voice, and `NONE` when the next step is not obvious. The call sets `purpose: 'composer-prediction'` and caps output at `maxOutputTokens`. It makes exactly one attempt. A tool call, a `max-tokens` finish, an error, or an abort yields no suggestion.

**Cancellation.** A new `turn/start`, a user message inserted into the inbox, disposal of the Agent, or plugin disposal aborts the in-flight request through its `AbortSignal`. A request aborted before its result is appended records no result.

**Output filter.** A port of the Hermes `reject_reason` and `_clean` rules accepts, after unwrapping labels, role prefixes, quotes, and wrapper tags, a reply of 2 to 12 words under 100 code points, and also a single word when it is a slash command, a stock reply such as `yes`, `continue`, or `да`, or at least two characters of an unspaced script. It abstains on `NONE` and rejects meta text about silence, error text, fill-in placeholders, multiple sentences, formatting, praise or thanks, and assistant-voice openings. The rules cover English, Russian, and unspaced CJK scripts.

**Session log.** Two experimental plugin records, appended through `appendPluginRecord`, keep the auxiliary request reconstructable without a Session format change:

- `plugin:composer-prediction/request`, before dispatch: the turn, the replayed `turn/end` seq, provider, model, `maxTokens`, and the instruction text.
- `plugin:composer-prediction/result`, after the reply: `{ requestSeq, turn, outcome, text | null, reason?, usage? }`.

**Projection.** A `composerPrediction` unit on `ctx.sessionProjections` folds the log into `{ turn, text } | null` for the latest started turn. An accepted result record for that turn sets it; a new `turn/start`, a user message, or a non-empty inbox insertion clears it. Clients receive the value through the existing projection carriers, so it survives reload and reconnect and every client sees the same value.

**Configuration.** `maxOutputTokens`, `timeoutMs`, `minAssistantMessages`, and `maxUncachedTokens` are validated required `Config` fields settable from `cordis.yml`; the bundle supplies 1024, 60000, 2, and 10000.

### Product seam: composer suggestion in `dsh-client-ui-conversation`

The Conversation service exposes one root-scope registry as `ctx.conversation.suggestions`. It accepts one provider whose `forSession(sessionId)` returns an observable `string | undefined` source for that Session, and `storeFor(sessionId)` returns an identity-stable source that follows registration changes. A second concurrent registration throws, and each registration returns its own disposer, which never withdraws a later one. Registration runs through `ctx.effect`.

**Visibility.** The suggestion is a placeholder, never draft text. The composer shows it when the draft is empty, no attachment or command chip is present, the Session is idle, and no `/` or `@` menu is open. The suggestion outranks the default and plan placeholders; owner-supplied placeholders (Hero, unavailable, parent offline) and the steer-queue hint outrank it. Typing hides it, clearing the draft shows it again, and the next completed turn replaces or clears it. The composer offers no dismissal: typing a different message is how a user ignores it.

**Presentation.** The suggestion renders in the placeholder position with ghost styling and a trailing locale-owned Tab key hint. The hint is a real button, out of the tab order because the focused editor owns acceptance, and clicking or tapping it accepts the suggestion, so touch devices without a Tab key can accept it. The editor references the suggestion and its hint through `aria-describedby`.

**Keys.** Acceptance keys act only while the composer editor has focus; the keymap registers them as Lexical editor commands, which the editor dispatches only for its own focused root. They run after trigger-menu arbitration passes:

- Plain Tab or Right arrow, with no modifier and outside IME composition, while the live editor document is empty and a suggestion is visible, writes the suggestion text through `setDraft` with the caret at its end. It never submits. The emptiness check reads the Lexical document rather than React state, so a character typed in the same frame is never replaced. Without a visible suggestion, Tab keeps its native focus traversal.
- Shift+Tab, modified Right arrow, and Escape keep their behavior.

Without a provider, the composer behaves as it did before.

### Client plugin and bundle

`@deepseek-ai/dsh-experimental-client-ui-composer-prediction` registers the provider and maps each Session's `composerPrediction` projection to its text, with a local wire guard and one identity-stable source per Session. It owns no other UI.

`@deepseek-ai/dsh-experimental-composer-prediction-bundle` inserts the Host and Client rows, ships localized metadata, a provisional experimental icon, and a README, and is offered through `OPTIONAL_BUNDLES`, so the Plugins page's More list shows it switched off. No example composition ships: an `apps/cli/config/examples/` entry would need an `apps/cli` dependency and a `docs/user/` guide, and the bundle already provides the selectable path. The default product composes only the seam, which stays inert without a provider.

### Documentation

Each new package README carries a Model Experience section: what the prediction model sees, its token cost, its KV cache effect, and that it adds nothing to the main conversation's requests. The `dsh-client-ui-conversation` README and JSDoc document the suggestion seam. Generated catalogs are refreshed.

## Alternatives considered

**A separate cheap model over a short transcript.** Hermes uses this path when the prediction task routes to another provider or model. A cold request on every turn loses the warm prefix and sees only the last few messages, so predictions are both less informed and not cheaper per useful token on DeepSeek's prefix cache. A routed path can be added later behind explicit `provider`/`model` configuration if a consumer needs it; supporting both now doubles the request code and tests.

**Host memory plus a Remote read, as Hermes `complete.suggest` does.** The prediction would vanish on restart, and the auxiliary request would still have to be logged to keep model-visible input reconstructable. It would also need a new Remote namespace and a push or poll channel, which session projections already provide.

**A Session event in `SessionEventMap`.** A released event type commits to a durable schema and migration obligations for a decorative experimental value. Plugin records are designated for experimental plugin-owned state that its owner can lose without changing how the rest of the log is interpreted.

**Default-on product feature with a settings switch.** Hermes enables predictions by default. Every completed turn bills one extra, mostly cached, request, and the prediction quality on DSH is unmeasured. Promotion from the experimental group can follow evidence.

**A slot whose component publishes the suggestion.** Slot occupants render React components; Tab acceptance needs the suggestion text synchronously inside the keymap. A component that only publishes data through an effect would hide a data provider behind rendering and lag the keymap by a commit.

## Consequences

- **Billing.** Each completed turn that passes the skip rules can issue one extra request. The cold-cache guard and the early-conversation skip bound the cost, and a provider that reports no usage never predicts; a provider that miscounts cache reads only makes the guard an estimate.
- **Cache parity.** The replay reuses the compaction summarizer's reconstruction, so a request-derivation difference or a tool-declaration change since the logged request misses the cache and is billed in full. The guard cannot detect that divergence in advance, because only the provider's answer reveals it.
- **Prediction quality.** A wrong guess costs nothing: typing replaces it, and no guess is ever sent automatically. The filter and the `NONE` instruction prefer silence, so a missed prediction is the common failure rather than a bad one.
- **Tab ownership.** Claiming plain Tab in a focused empty composer removes forward focus traversal from the editor only while a suggestion is visible; keyboard users still leave with Shift+Tab, and the hint button covers touch devices.
- **Single provider.** The registry accepts one provider, so only one suggestion source can exist per Client tree; a second registration fails loudly instead of silently winning.
- **Provider absence.** Without a provider the composer keeps its placeholders and Tab traversal, so the seam changes nothing until a bundle or composition registers one.

## Testing

- Unit tests cover the output filter rules, the skip rules and the frozen request, the projection fold, and the instruction literal.
- A Loader composition test in `tests/composer-prediction.e2e.ts` boots a test `cordis.yml` through the production profile with only the LLM adapter mocked, and asserts one request and one result record after the second completed turn, with the replayed messages a prefix of the last routed request followed by the reply and the instruction.
- The keyless recorded-session snapshot in `snapshots/sdk/composer-prediction/` replays the auxiliary request through the shipped SDK profile.
- Client tests cover acceptance from the focused editor, the unfocused editor, same-frame typing, reappearance after clearing, IME composition, an open trigger menu, and the provider-absent path.
