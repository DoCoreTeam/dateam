/**
 * A suggestion laid beside what is there now.
 *
 * Showing only the suggestion asks a person to approve a change without seeing what it
 * replaces. Rows that already agree stay on screen, marked, because "unchanged" is also
 * something the reader needs to know.
 */

import type { ReactNode } from 'react'
import type { AiLabels } from './labels.ts'
import { diffRows, type DiffRow } from './review.ts'

export interface SuggestionDiffProps<T> {
  current: Record<string, T>
  suggested: Record<string, T>
  labels: Pick<AiLabels, 'accept' | 'reject'>
  /** What to call each field. The package never names a field */
  fieldLabel: (field: string) => string
  render: (value: T) => ReactNode
  onAccept: (field: string) => void
  onReject: (field: string) => void
  className?: string
}

export function SuggestionDiff<T>({
  current, suggested, labels, fieldLabel, render, onAccept, onReject, className,
}: SuggestionDiffProps<T>) {
  const rows: DiffRow<T>[] = diffRows(current, suggested)
  return (
    <table className={className} data-ai-diff="true">
      <tbody>
        {rows.map((r) => (
          <tr key={r.field} data-ai-part="diff-row" data-same={r.same ? 'true' : 'false'}>
            <th scope="row">{fieldLabel(r.field)}</th>
            <td data-side="current">{render(r.current)}</td>
            <td data-side="suggested">{render(r.suggested)}</td>
            <td>
              {r.same ? null : (
                <>
                  <button type="button" onClick={() => onAccept(r.field)}>{labels.accept}</button>
                  <button type="button" onClick={() => onReject(r.field)}>{labels.reject}</button>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
