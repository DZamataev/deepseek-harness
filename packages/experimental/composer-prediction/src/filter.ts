/**
 * Acceptance rules for a predicted next user message: a reply that announces silence, praises,
 * speaks as the assistant, or is not a short single message is no suggestion.
 *
 * Ported from Hermes `tui_gateway/suggest_predict.py`; rule order is verdict order, so the first
 * failing rule is the reported reason. Python's `\w`, `\b`, and `\W` are Unicode-aware while
 * JavaScript's are ASCII-only, so the port spells out the Unicode-aware forms instead. Python's
 * `len()` counts code points, so text length comes from {@link codePointLength} rather than from
 * UTF-16 `String#length`.
 *
 * @module @deepseek-ai/dsh-experimental-composer-prediction/filter
 */

/** Longest accepted suggestion in words. */
export const MAX_PREDICTION_WORDS = 12

/** Longest accepted suggestion in characters; the ceiling is exclusive. */
export const MAX_PREDICTION_CHARS = 100

/** Which acceptance rule refused a reply; each names one rule in {@link rejectReason} order. */
export type RejectReason = 'meta_text' | 'meta_wrapped' | 'error_message' | 'placeholder' | 'prefixed_label'
  | 'too_few_words' | 'too_many_words' | 'too_long' | 'multiple_sentences' | 'has_formatting' | 'evaluative'
  | 'assistant_voice'

/** Verdict for one assembled reply: accepted ghost text, silence, or the first failed rule. */
export type CleanResult = { kind: 'accepted'; text: string } | { kind: 'abstained' } | { kind: 'rejected'; reason: RejectReason }

/** Sentinel reply that asks for no suggestion instead of a message. */
const NONE = 'NONE'

/** One-word replies that are complete messages on their own. */
const SHORT_OK: ReadonlySet<string> = new Set([
  'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'no', 'push', 'commit', 'deploy', 'stop', 'continue',
  'check', 'exit', 'quit', 'да', 'нет', 'ок', 'окей', 'ага', 'давай', 'делай', 'сделай', 'продолжай', 'продолжи',
  'дальше', 'стоп', 'отмена', 'коммить', 'закоммить', 'пуш', 'запушь', 'деплой', 'проверь', 'покажи', 'запусти',
  'исправь', '好', '是', '对', '不', '停', '走', '可', '否', '네', '예', 'はい',
])

/** Scripts written without spaces between words (kana, CJK ideographs, hangul). */
const UNSPACED_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/gu

/** A reply wrapped in one of the tags the model was told not to use. */
const WRAPPER_TAG_RE = /^<(suggestion|response|output|answer|result)>(.*)<\/\1>$/isu

/** A role or suggestion label the model put in front of the message. */
const LABEL_RE = new RegExp(
  String.raw`^\s*(?:suggested\s+(?:response|reply|input|prompt)|suggestion|response|reply|answer|output|result`
  + String.raw`|предложение|подсказка|ответ)\s*[:：]\s*`,
  'iu',
)

/** A reply about the prediction itself ("nothing to suggest") or one that announces silence. */
const META_RE = new RegExp(
  String.raw`^nothing (?:found|to suggest)|^no suggestion|\bsilence is\b|\bstay(?:s|ing)? silent\b`
  + String.raw`|^[^\p{L}\p{N}_]*silence[^\p{L}\p{N}_]*$`
  + String.raw`|^[^\p{L}\p{N}_]*(?:done|готово|молчу|молчание|нет предложени[йя]|нечего предложить)[^\p{L}\p{N}_]*$`,
  'iu',
)

/** A whole reply in parentheses or brackets: a stage direction, not a message. */
const BRACKETED_RE = /^(?:\(.*\)|\[.*\]|（.*）|【.*】)$/su

/**
 * A fill-in-the-blank template ("the parser is in [path to file]") is not a message anyone types:
 * a bracketed phrase of two or more plain words, standing on its own. One-word groups, anything
 * attached to an identifier, and anything with operators stay: a[10], Promise<Result>, </div>,
 * [docs](url), ${name}, and "x < 10 and y > 20" are ordinary code talk.
 */
const PLACEHOLDER_RE = /(?<![\p{L}\p{N}_$)])(?<!\])(?:\[(?<a>[^\[\]\n]+)\](?!\()|<(?<b>[^<>\n]+)>|\{(?<c>[^{}\n]+)\})|…{2,}|_{3,}/gu

/** A placeholder body that is a phrase rather than a single word or model. */
const PLACEHOLDER_PHRASE_RE = /^[\p{L}\p{Nl}\p{No}][\p{L}\p{N}_'’-]*(?: [\p{L}\p{N}_'’-]+)+$/u

/** Transport or provider failures the model echoed back instead of a suggestion. */
const ERROR_PREFIXES: readonly string[] = [
  'api error:', 'prompt is too long', 'request timed out', 'invalid api key', 'image was too large',
]

/** Two sentences: the reply continues past one message. */
const SENTENCE_BREAK_RE = /[.!?]\s+[A-ZА-ЯЁ]|[。！？]\s*[\p{L}\p{N}_]/u

/** Praise or agreement: the user's next message is not a review of the assistant's work. */
const EVALUATIVE_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}_])(?:thanks|thank you|looks good|sounds good|that works|that worked|that's all`
  + String.raw`|nice|great|perfect|makes sense|awesome|excellent|спасибо|благодарю|отлично|супер|круто`
  + String.raw`|выглядит хорошо|звучит хорошо|всё работает|все работает)(?![\p{L}\p{N}_])`,
  'iu',
)

/** The reply answers as the assistant instead of speaking as the user. */
const ASSISTANT_VOICE_RE = new RegExp(
  String.raw`^(?:let me|i'll|i've|i'm|i can|i would|i think|i notice|here's|here is|here are|that's|this is|this will`
  + String.raw`|you can|you should|you could|sure,|of course|certainly|давайте я|сейчас я|я сейчас|я могу|я сделаю`
  + String.raw`|я думаю|вот |вы можете|ты можешь|конечно,)`,
  'iu',
)

/** A word followed by a colon; the message is behind a label the model invented. */
const PREFIXED_LABEL_RE = /^[\p{L}\p{N}_]+:\s/u

/** A transcript role label the model echoed back ("USER: ..."). */
const ROLE_PREFIX_RE = /^(?:user|assistant)\s*:\s*/iu

/**
 * Count words with unspaced scripts folded in, as Hermes does: about two characters of kana, CJK
 * ideographs, or hangul count as one word, so a normal phrase is neither one word nor rejected.
 * The `length` reads below count regex matches and whitespace tokens, not UTF-16 units.
 * @param text - unwrapped reply.
 * @returns Approximate word count.
 */
function wordCount(text: string): number {
  const unspaced = text.match(UNSPACED_RE)?.length ?? 0
  const spaced = text.replace(UNSPACED_RE, ' ').match(/\S+/gu)?.length ?? 0
  return spaced + Math.ceil(unspaced / 2)
}

/**
 * Whether a reply is too short to be a message: one word is rarely one, except a slash command, a
 * stock one-word reply, or two characters of an unspaced script ("继续").
 * @param text - unwrapped reply.
 * @param lower - the same reply lowercased.
 * @param words - its {@link wordCount}.
 * @returns True when the reply is below the minimum.
 */
function tooShort(text: string, lower: string, words: number): boolean {
  if (words >= 2 || text.startsWith('/') || SHORT_OK.has(lower.replace(/^[.!。！]+|[.!。！]+$/gu, ''))) return false
  return (text.match(UNSPACED_RE)?.length ?? 0) < 2
}

/**
 * Whether a reply contains a fill-in-the-blank placeholder rather than a message.
 * @param text - unwrapped reply.
 * @returns True when one bracket, brace, ellipsis, or blank holds a phrase.
 */
function hasPlaceholder(text: string): boolean {
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    const inner = match.groups?.a ?? match.groups?.b ?? match.groups?.c
    if (inner === undefined || PLACEHOLDER_PHRASE_RE.test(inner)) return true
  }
  return false
}

/**
 * Remove surrounding single or double quotes the way Python's `str.strip("\"'")` does.
 * @param text - reply text.
 * @returns The text without leading or trailing quote characters.
 */
function stripQuotes(text: string): string {
  return text.replace(/^["']+|["']+$/gu, '')
}

/**
 * Count Unicode code points the way Python's `len()` does: an astral character is one code point
 * but two UTF-16 units, so the ceiling must not charge it twice.
 * @param text - text to measure.
 * @returns The number of code points.
 */
function codePointLength(text: string): number {
  return Array.from(text).length
}

/**
 * Report the first acceptance rule an unwrapped reply fails.
 * @param text - unwrapped reply.
 * @returns The first failed rule, or undefined when the reply is a usable suggestion.
 */
export function rejectReason(text: string): RejectReason | undefined {
  const lower = text.toLowerCase()
  const words = wordCount(text)
  if (META_RE.test(lower)) return 'meta_text'
  if (BRACKETED_RE.test(text)) return 'meta_wrapped'
  if (ERROR_PREFIXES.some(prefix => lower.startsWith(prefix))) return 'error_message'
  if (hasPlaceholder(text)) return 'placeholder'
  if (PREFIXED_LABEL_RE.test(text)) return 'prefixed_label'
  if (tooShort(text, lower, words)) return 'too_few_words'
  if (words > MAX_PREDICTION_WORDS) return 'too_many_words'
  if (codePointLength(text) >= MAX_PREDICTION_CHARS) return 'too_long'
  if (SENTENCE_BREAK_RE.test(text)) return 'multiple_sentences'
  if (text.includes('\n') || text.includes('*')) return 'has_formatting'
  if (EVALUATIVE_RE.test(lower)) return 'evaluative'
  if (ASSISTANT_VOICE_RE.test(text)) return 'assistant_voice'
  return undefined
}

/**
 * Unwrap a model reply and apply every acceptance rule.
 * @param raw - assembled reply text.
 * @returns The cleaned suggestion, silence when the model abstained, or the first failed rule.
 */
export function cleanPrediction(raw: string): CleanResult {
  const unwrapped = raw.trim().replace(WRAPPER_TAG_RE, '$2').trim()
  const unlabeled = stripQuotes(unwrapped).replace(LABEL_RE, '').replace(ROLE_PREFIX_RE, '')
  const text = stripQuotes(unlabeled.trim())
  if (codePointLength(text) === 0 || text.toUpperCase().replace(/\.+$/u, '') === NONE) return { kind: 'abstained' }
  const reason = rejectReason(text)
  if (reason !== undefined) return { kind: 'rejected', reason }
  return { kind: 'accepted', text }
}
