/** Pure diff-card derivation from raw file-mutation calls and result metadata. @module */
import type { DiffBlockProps, DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import { abbreviateHomePath, relativizeToCwd } from '@deepseek-ai/dsh-util-workspace-path'
import type { ToolCallBlock } from './tool-call-model.ts'
import { parsedToolCall } from './raw-tool-call.ts'
import { recordedAbsolutePath } from './recorded-path.ts'

/** Room for a path, one removed/added pair, and three context lines on each side. */
export const CHAT_DIFF_MAX_LINES = 9

/**
 * The {@link DiffBlock} props this derivation owns. Picked off the primitive's
 * props so the two stay in step; `maxLines`/`className` belong to each render
 * site.
 */
export interface DiffCardModel {
  /**
   * The props {@link DiffBlock} draws. Held as a nested object so a render site
   * spreads exactly the primitive's own surface and can never leak a
   * neighbouring field into it.
   */
  card: Pick<DiffBlockProps, 'diffs'>
  /** Present when the call only checked its change (`dry_run: true`), so the card shows what would change. */
  dryRun?: true
}

/**
 * Narrow opaque result metadata's `diffs` to well-formed hunks. A hunk may
 * carry `truncated: true`, which the card draws as a too-large notice.
 * @param diffs - the metadata field to validate.
 * @returns the validated hunks, or null when the payload is not usable.
 */
function narrowDiffs(diffs: unknown): DiffHunk[] | null {
  if (!Array.isArray(diffs) || diffs.length === 0) return null
  const out: DiffHunk[] = []
  for (const hunk of diffs) {
    if (typeof hunk !== 'object' || hunk === null) return null
    const { path, oldText, newText, truncated } = hunk as Record<string, unknown>
    if (typeof path !== 'string') return null
    if (oldText !== null && typeof oldText !== 'string') return null
    if (typeof newText !== 'string') return null
    if (truncated !== undefined && typeof truncated !== 'boolean') return null
    out.push(truncated === true ? { path, oldText, newText, truncated } : { path, oldText, newText })
  }
  return out
}

type IntendedDiff = { tool: 'write' | 'edit' | 'str_replace_editor'; diff: DiffHunk }

function intendedDiff(block: ToolCallBlock): IntendedDiff | null {
  const parsed = parsedToolCall(block)
  if (parsed === null) return null
  if (parsed.name === 'str_replace_editor') {
    const { command, path, file_text: fileText, old_str: oldText, new_str: newText } = parsed.args
    if (typeof path !== 'string' || path.trim() === '') return null
    if (command === 'create') {
      if (fileText !== undefined && typeof fileText !== 'string') return null
      return {
        tool: 'str_replace_editor',
        diff: { path, oldText: null, newText: fileText ?? '' },
      }
    }
    if (command === 'str_replace') {
      if (oldText !== undefined && typeof oldText !== 'string') return null
      if (newText !== undefined && typeof newText !== 'string') return null
      return {
        tool: 'str_replace_editor',
        diff: { path, oldText: oldText ?? null, newText: newText ?? '' },
      }
    }
    return null
  }
  const { file_path: path } = parsed.args
  if (typeof path !== 'string' || path.trim() === '') return null
  if (parsed.name === 'write') {
    const { content } = parsed.args
    return typeof content === 'string'
      ? { tool: 'write', diff: { path, oldText: null, newText: content } }
      : null
  }
  if (parsed.name !== 'edit') return null
  const { old_string: oldText, new_string: newText, replace_all: replaceAll } = parsed.args
  if (typeof oldText !== 'string' || typeof newText !== 'string') return null
  if (replaceAll !== undefined && typeof replaceAll !== 'boolean') return null
  return { tool: 'edit', diff: { path, oldText: oldText || null, newText } }
}

function appliedDiffs(meta: unknown): DiffHunk[] | 'empty' | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const diffs = (meta as Record<string, unknown>).diffs
  if (!Array.isArray(diffs)) return null
  if (diffs.length === 0) return 'empty'
  return narrowDiffs(diffs)
}

/**
 * Present the applied hunks another tool recorded under the `meta.diffs`
 * convention of `write`/`edit`, such as an external `apply_patch`. Hunks of one
 * file stay together in first-seen file order, so the card draws one section
 * per file, and recorded absolute paths display relative to the Session
 * directory.
 */
function recordedCard(block: ToolCallBlock, cwd: string | undefined, home: string | undefined): DiffCardModel | null {
  if (!('kind' in block) || block.isError) return null
  const parsed = parsedToolCall(block)
  if (parsed === null) return null
  const applied = appliedDiffs(block.meta)
  if (applied === null || applied === 'empty') return null
  const files = new Map<string, DiffHunk[]>()
  for (const diff of applied) {
    const hunks = files.get(diff.path)
    if (hunks === undefined) files.set(diff.path, [diff])
    else hunks.push(diff)
  }
  const diffs = [...files].flatMap(([path, hunks]) => {
    const label = abbreviateHomePath(relativizeToCwd(path, cwd), home)
    return hunks.map(hunk => ({ ...hunk, path: label }))
  })
  return parsed.args.dry_run === true ? { card: { diffs }, dryRun: true } : { card: { diffs } }
}

/**
 * Derive running diffs for root write/edit and `str_replace_editor`
 * create/replace calls, plus applied settled diffs for root write/edit calls.
 * A successful write with valid empty metadata uses its argument-derived
 * whole-file diff, matching create and identical-overwrite presentation;
 * `str_replace_editor` settles through Generic because it has no result view.
 * Any other successful root call whose result metadata carries valid,
 * non-empty `diffs` settles to those recorded hunks; while it runs it stays generic.
 * @param block - running or settled Tool block.
 * @param cwd - Session directory; recorded hunk paths of other tools display relative to it.
 * @param home - host account home; a recorded path outside `cwd` under it displays as `~/…`.
 * @returns the diff-card props, or null for the generic path.
 */
export function diffCardModel(block: ToolCallBlock, cwd?: string, home?: string): DiffCardModel | null {
  if (block.parentCallId !== undefined) return null
  const intended = intendedDiff(block)
  if (intended === null) return recordedCard(block, cwd, home)
  if (!('kind' in block)) return { card: { diffs: [intended.diff] } }
  if (intended.tool === 'str_replace_editor') return null
  if (block.isError) return null
  const applied = appliedDiffs(block.meta)
  if (applied === null || applied === 'empty') {
    return intended.tool === 'write' ? { card: { diffs: [intended.diff] } } : null
  }
  const path = recordedAbsolutePath(block.meta, 'path')
  return { card: { diffs: applied.map(diff => diff.path === path ? { ...diff, path: intended.diff.path } : diff) } }
}
