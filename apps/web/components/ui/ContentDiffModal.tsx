'use client'
import { useEscClose } from '@/lib/use-esc-close'

import { useState } from 'react'
import type { ColumnDef } from '@/components/ui/DynamicTable'

export interface ContentDiffModalProps {
  sectionName: string
  columns: ColumnDef[]
  original: Record<string, unknown>[]
  proposed: Record<string, unknown>[]
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

type RowStatus = 'added' | 'deleted' | 'modified' | 'unchanged'

interface DiffRow {
  status: RowStatus
  original: Record<string, unknown> | null
  proposed: Record<string, unknown> | null
}

function diffRows(
  original: Record<string, unknown>[],
  proposed: Record<string, unknown>[],
  keyCol: string
): DiffRow[] {
  const origMap: Record<string, Record<string, unknown>> = {}
  original.forEach((r) => { origMap[String(r[keyCol] ?? '')] = r })

  const propMap: Record<string, Record<string, unknown>> = {}
  proposed.forEach((r) => { propMap[String(r[keyCol] ?? '')] = r })

  const result: DiffRow[] = []

  Object.entries(propMap).forEach(([k, propRow]) => {
    const origRow = origMap[k]
    if (!origRow) {
      result.push({ status: 'added', original: null, proposed: propRow })
    } else if (JSON.stringify(origRow) === JSON.stringify(propRow)) {
      result.push({ status: 'unchanged', original: origRow, proposed: propRow })
    } else {
      result.push({ status: 'modified', original: origRow, proposed: propRow })
    }
  })

  Object.entries(origMap).forEach(([k, origRow]) => {
    if (!propMap[k]) {
      result.push({ status: 'deleted', original: origRow, proposed: null })
    }
  })

  return result
}

const STATUS_BADGE: Record<RowStatus, { label: string; bg: string; color: string }> = {
  added:     { label: '추가됨', bg: 'var(--success-bg)', color: 'var(--success)' },
  deleted:   { label: '삭제됨', bg: 'var(--danger-bg)', color: 'var(--danger)' },
  modified:  { label: '수정됨', bg: 'var(--warning-bg)', color: 'var(--warning)' },
  unchanged: { label: '변경없음', bg: 'var(--surface-muted)', color: 'var(--text-muted)' },
}

function renderValue(val: unknown): string {
  if (Array.isArray(val)) return val.join(', ')
  if (val === null || val === undefined || val === '') return '—'
  return String(val)
}

export default function ContentDiffModal({
  sectionName,
  columns,
  original,
  proposed,
  onConfirm,
  onCancel,
  loading = false,
}: ContentDiffModalProps) {
  useEscClose(onCancel)
  const keyCol = columns[0]?.key ?? 'id'
  const rows = diffRows(original, proposed, keyCol)

  const changedCount = rows.filter((r) => r.status !== 'unchanged').length
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${sectionName} AI 편집 확인`}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'var(--modal-backdrop)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
    >
      <div style={{
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-modal)',
        width: '100%',
        maxWidth: '780px',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: 'var(--space-5) var(--space-6)',
          borderBottom: 'var(--border-w-2) solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)' }}>
              AI 편집 결과 — {sectionName}
            </div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              {changedCount === 0
                ? '변경사항이 없습니다'
                : `${changedCount}개 행이 변경되었습니다. 적용하시겠습니까?`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {Object.entries(STATUS_BADGE)
              .filter(([k]) => rows.some((r) => r.status === k))
              .map(([k, s]) => (
                <span key={k} style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '9999px',
                  fontSize: 'var(--fs-xs)', fontWeight: 600,
                  background: s.bg, color: s.color,
                }}>
                  {s.label} {rows.filter((r) => r.status === k).length}
                </span>
              ))}
          </div>
        </div>

        {/* Row list */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {rows.map((row, idx) => {
            const s = STATUS_BADGE[row.status]
            const isExpanded = expandedIdx === idx
            const displayRow = row.proposed ?? row.original ?? {}
            const isExpandable = row.status === 'modified'

            return (
              <div key={idx} style={{
                borderBottom: 'var(--hairline) solid var(--surface-muted)',
                background: row.status === 'deleted' ? 'var(--danger-bg)' : row.status === 'added' ? 'var(--success-bg)' : row.status === 'modified' ? 'var(--warning-bg)' : 'var(--color-surface)',
              }}>
                <div
                  style={{
                    padding: 'var(--space-3) var(--space-6)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    cursor: isExpandable ? 'pointer' : 'default',
                  }}
                  onClick={() => isExpandable && setExpandedIdx(isExpanded ? null : idx)}
                >
                  <span style={{
                    flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '9999px',
                    fontSize: '0.7rem', fontWeight: 700,
                    background: s.bg, color: s.color,
                    minWidth: '52px', justifyContent: 'center',
                  }}>
                    {s.label}
                  </span>

                  {/* Key field value */}
                  <span style={{ fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--text)', minWidth: '120px' }}>
                    {renderValue(displayRow[keyCol])}
                  </span>

                  {/* Other fields preview */}
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {columns.slice(1, 3).map((c) => `${c.label}: ${renderValue(displayRow[c.key])}`).join('  ·  ')}
                  </span>

                  {isExpandable && (
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', flexShrink: 0 }}>
                      {isExpanded ? '접기 ▲' : '상세 ▼'}
                    </span>
                  )}
                </div>

                {/* Expanded diff for modified rows */}
                {isExpanded && row.status === 'modified' && (
                  <div style={{
                    padding: 'var(--space-0) var(--space-6) var(--space-4)',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 'var(--space-4)',
                  }}>
                    <div>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>이전</div>
                      {columns.map((c) => {
                        const oldVal = renderValue(row.original?.[c.key])
                        const newVal = renderValue(row.proposed?.[c.key])
                        const changed = oldVal !== newVal
                        return (
                          <div key={c.key} style={{ marginBottom: '0.25rem', fontSize: 'var(--fs-sm)' }}>
                            <span style={{ color: 'var(--text-faint)', marginRight: '0.375rem' }}>{c.label}:</span>
                            <span style={{ color: changed ? 'var(--danger)' : 'var(--text-muted)', textDecoration: changed ? 'line-through' : 'none' }}>
                              {oldVal}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>이후</div>
                      {columns.map((c) => {
                        const oldVal = renderValue(row.original?.[c.key])
                        const newVal = renderValue(row.proposed?.[c.key])
                        const changed = oldVal !== newVal
                        return (
                          <div key={c.key} style={{ marginBottom: '0.25rem', fontSize: 'var(--fs-sm)' }}>
                            <span style={{ color: 'var(--text-faint)', marginRight: '0.375rem' }}>{c.label}:</span>
                            <span style={{ color: changed ? 'var(--success)' : 'var(--text-muted)', fontWeight: changed ? 600 : 400 }}>
                              {newVal}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: 'var(--space-4) var(--space-6)',
          borderTop: 'var(--border-w-2) solid var(--border-color)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 'var(--space-3)',
          flexShrink: 0,
          background: 'var(--color-bg)',
        }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: 'var(--space-2) var(--space-5)',
              background: 'transparent',
              color: 'var(--text-muted)',
              border: 'var(--border-w-2) solid var(--border-color)',
              borderRadius: 'var(--radius)',
              fontSize: 'var(--fs-base)',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading || changedCount === 0}
            style={{
              padding: 'var(--space-2) var(--space-6)',
              background: changedCount === 0 ? 'var(--color-border)' : 'var(--brand)',
              color: changedCount === 0 ? 'var(--text-faint)' : 'var(--color-surface)',
              border: 'none',
              borderRadius: 'var(--radius)',
              fontSize: 'var(--fs-base)',
              fontWeight: 600,
              cursor: changedCount === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '저장 중…' : `적용 (${changedCount}건)`}
          </button>
        </div>
      </div>
    </div>
  )
}
