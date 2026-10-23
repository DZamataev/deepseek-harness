import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import { NS } from './locales.ts'
import css from './SubagentReadOnlyComposer.module.css'

/** Why a catalog-addressed conversation cannot accept human input. */
export interface SubagentReadOnlyMatch {
  reason: 'one-shot' | 'parent-unavailable' | 'unknown'
}

/** Full chain props after the read-only subagent selector accepts the owner currency. */
export type SubagentReadOnlyComposerProps =
  PropsRuntime<'conversation.composer'> & { matched: SubagentReadOnlyMatch } & PropsLocale<typeof NS>

/**
 * Explain why the normal composer is unavailable for an addressed child, and
 * name the model route of its latest recorded request when one exists.
 * @param props - selector-owned read-only reason plus standard slot props.
 * @returns A read-only composer replacement.
 */
export function SubagentReadOnlyComposer({
  matched, useProjection, t,
}: Pick<SubagentReadOnlyComposerProps, 'matched' | 'useProjection' | 't'>) {
  const oneShot = matched.reason === 'one-shot'
  const route = useProjection('modelSelection')?.lastUsed ?? null
  return (
    <div className={css.frame} role="status">
      <strong>{t(oneShot ? 'readonly.oneShot.title' : 'readonly.title')}</strong>
      <span>
        {t(matched.reason === 'unknown' ? 'readonly.unknown.body' : oneShot ? 'readonly.oneShot.body' : 'readonly.body')}
      </span>
      {route !== null && (
        <span className={css.model}>
          {route.reasoningEffort === undefined
            ? t('readonly.model', { model: route.model })
            : t('readonly.modelEffort', { model: route.model, effort: route.reasoningEffort })}
        </span>
      )}
    </div>
  )
}
