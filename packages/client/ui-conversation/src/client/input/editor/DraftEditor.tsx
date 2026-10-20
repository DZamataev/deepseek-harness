/** Stateless text-area presentation over the InputBar's borrowed editor. */
import { useId } from 'react'
import type { CSSProperties, KeyboardEventHandler, ReactNode, RefObject } from 'react'
import type { LexicalEditor } from 'lexical'
import clsx from 'clsx'
import type { InputState } from '../../contract/input.ts'
import { ComposerContentEditable } from './ComposerContentEditable.tsx'
import { DecoratorPortals } from './DecoratorPortals.tsx'
import { keepDraftFocus } from './view-binding.ts'

/**
 * One visible composer suggestion: the ghost text plus the key affordance
 * that accepts it. Only presentation and the accept callback live here — the
 * bar owns visibility, the draft write, and the localized copy.
 */
export interface DraftSuggestion {
  /** Predicted text shown in the placeholder position. */
  readonly text: string
  /** Localized label of the accepting key. */
  readonly keyLabel: string
  /** Localized sentence naming the suggestion and its accept key for the accessible description. */
  readonly description: string
  /** Write the suggestion into the draft without submitting. */
  readonly onAccept: () => void
}

/** Text-area values and the scrollport reference retained by InputBar. */
export interface DraftEditorProps {
  readonly classNames: Readonly<Record<string, string>>
  readonly editor: LexicalEditor | null
  readonly scrollRef: RefObject<HTMLDivElement>
  readonly editable: boolean
  readonly editorDisabled: boolean
  readonly phase: InputState['phase'] | 'inert'
  readonly placeholderText: string
  readonly ariaLabel: string
  /** Visible suggestion; absent while no suggestion owns the empty composer. */
  readonly suggestion?: DraftSuggestion | undefined
  readonly workspaceTrigger: boolean
  readonly workspacePickerOpen: boolean
  readonly onWorkspaceKeyDown: KeyboardEventHandler<HTMLDivElement>
  readonly hint: string | null
  readonly showPlaceholder: boolean
}

/**
 * Render the existing scrollport, editable surface, placeholder, and chip portals.
 * @param props - borrowed editor and presentation values; this component owns only the description id.
 * @returns the existing text-area DOM without an additional wrapper.
 */
export function DraftEditor({
  classNames: css, editor, scrollRef, editable, editorDisabled, phase, placeholderText, ariaLabel,
  suggestion, workspaceTrigger, workspacePickerOpen, onWorkspaceKeyDown, hint, showPlaceholder,
}: DraftEditorProps): ReactNode {
  // The accessible name stays the ordinary placeholder copy; the description
  // carries the suggestion text and its accept-key instruction instead.
  const suggestionId = useId()
  const visibleSuggestion = showPlaceholder ? suggestion : undefined
  return (
    <div ref={scrollRef} className={css.scroll} data-input-scroll>
      <div className={css.grow}>
        <ComposerContentEditable
          editor={workspaceTrigger ? null : editor}
          editable={editable}
          className={clsx(css.input, editorDisabled && css.inputDisabled)}
          data-phase={phase}
          aria-disabled={editorDisabled || undefined}
          data-placeholder={placeholderText}
          // The placeholder was the textarea's accessible name; a div's
          // data attribute is not, so the label restores it.
          aria-label={ariaLabel}
          aria-describedby={visibleSuggestion === undefined ? undefined : suggestionId}
          aria-haspopup={workspaceTrigger ? 'menu' : undefined}
          aria-expanded={workspaceTrigger ? workspacePickerOpen : undefined}
          tabIndex={workspaceTrigger ? 0 : undefined}
          onKeyDown={workspaceTrigger ? onWorkspaceKeyDown : undefined}
          style={hint === null ? undefined : { '--dsh-composer-hint': JSON.stringify(hint) } as CSSProperties}
        />
        {showPlaceholder && (
          <div
            aria-hidden
            className={clsx(css.placeholder, visibleSuggestion !== undefined && css.placeholderSuggestion)}
            data-composer-placeholder
          >
            {visibleSuggestion === undefined ? placeholderText : (
              <span className={css.suggestion} data-composer-suggestion>{visibleSuggestion.text}</span>
            )}
          </div>
        )}
        {visibleSuggestion !== undefined && (
          <>
            <span id={suggestionId} className={css.srOnly}>{visibleSuggestion.description}</span>
            {/* Pointer-only shortcut: the key itself already accepts from the
                focused editor, so this hint stays out of the tab order and out
                of the accessibility tree. */}
            <kbd
              aria-hidden
              className={css.suggestionKey}
              data-composer-suggestion-key
              onMouseDown={(event) => { keepDraftFocus(event, editor) }}
              onClick={visibleSuggestion.onAccept}
            >{visibleSuggestion.keyLabel}</kbd>
          </>
        )}
        <DecoratorPortals editor={workspaceTrigger ? null : editor} />
      </div>
    </div>
  )
}
