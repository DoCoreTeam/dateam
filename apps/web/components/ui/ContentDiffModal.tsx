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
  added:     { label: '추가됨', bg: '#dcfce7', color: '#15803d' },
  deleted:   { label: '삭제됨', bg: '#fee2e2', color: '#b91c1c' },
  modified:  { label: '수정됨', bg: '#fef9c3', color: '#a16207' },
  unchanged: { label: '변경없음', bg: '#f1f5f9', color: '#64748b' },
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
        background: 'rgba(15,23,42,0.55)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div style={{
        background: '#fff',
        borderRadius: 'var(--radius)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        width: '100%',
        maxWidth: '780px',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '2px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
              AI 편집 결과 — {sectionName}
            </div>
            <div style={{ fontSize: '0.8125rem', color: '#64748b', marginTop: '0.2rem' }}>
              {changedCount === 0
                ? '변경사항이 없습니다'
                : `${changedCount}개 행이 변경되었습니다. 적용하시겠습니까?`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {Object.entries(STATUS_BADGE)
              .filter(([k]) => rows.some((r) => r.status === k))
              .map(([k, s]) => (
                <span key={k} style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '9999px',
                  fontSize: '0.75rem', fontWeight: 600,
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
                borderBottom: '1px solid #f1f5f9',
                background: row.status === 'deleted' ? '#fff5f5' : row.status === 'added' ? '#f0fdf4' : row.status === 'modified' ? '#fffbeb' : '#fff',
              }}>
                <div
                  style={{
                    padding: '0.75rem 1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
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
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', minWidth: '120px' }}>
                    {renderValue(displayRow[keyCol])}
                  </span>

                  {/* Other fields preview */}
                  <span style={{ fontSize: '0.8125rem', color: '#64748b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {columns.slice(1, 3).map((c) => `${c.label}: ${renderValue(displayRow[c.key])}`).join('  ·  ')}
                  </span>

                  {isExpandable && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--brand)', flexShrink: 0 }}>
                      {isExpanded ? '접기 ▲' : '상세 ▼'}
                    </span>
                  )}
                </div>

                {/* Expanded diff for modified rows */}
                {isExpanded && row.status === 'modified' && (
                  <div style={{
                    padding: '0 1.5rem 1rem',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '1rem',
                  }}>
                    <div>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>이전</div>
                      {columns.map((c) => {
                        const oldVal = renderValue(row.original?.[c.key])
                        const newVal = renderValue(row.proposed?.[c.key])
                        const changed = oldVal !== newVal
                        return (
                          <div key={c.key} style={{ marginBottom: '0.25rem', fontSize: '0.8125rem' }}>
                            <span style={{ color: '#94a3b8', marginRight: '0.375rem' }}>{c.label}:</span>
                            <span style={{ color: changed ? '#b91c1c' : '#475569', textDecoration: changed ? 'line-through' : 'none' }}>
                              {oldVal}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>이후</div>
                      {columns.map((c) => {
                        const oldVal = renderValue(row.original?.[c.key])
                        const newVal = renderValue(row.proposed?.[c.key])
                        const changed = oldVal !== newVal
                        return (
                          <div key={c.key} style={{ marginBottom: '0.25rem', fontSize: '0.8125rem' }}>
                            <span style={{ color: '#94a3b8', marginRight: '0.375rem' }}>{c.label}:</span>
                            <span style={{ color: changed ? '#15803d' : '#475569', fontWeight: changed ? 600 : 400 }}>
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
          padding: '1rem 1.5rem',
          borderTop: '2px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.75rem',
          flexShrink: 0,
          background: 'var(--color-bg)',
        }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: '0.5rem 1.25rem',
              background: 'transparent',
              color: '#64748b',
              border: '2px solid var(--border-color)',
              borderRadius: 'var(--radius)',
              fontSize: '0.875rem',
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
              padding: '0.5rem 1.5rem',
              background: changedCount === 0 ? 'var(--color-border)' : 'var(--brand)',
              color: changedCount === 0 ? '#94a3b8' : '#fff',
              border: 'none',
              borderRadius: 'var(--radius)',
              fontSize: '0.875rem',
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
