'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

export interface ColumnDef {
  key: string
  label: string
  type?: 'text' | 'number' | 'textarea' | 'tags'
  placeholder?: string
  width?: string
}

interface DynamicTableProps {
  name: string
  columns: ColumnDef[]
  initialData: Record<string, unknown>[]
  addLabel?: string
}

const INPUT: React.CSSProperties = {
  width: '100%',
  padding: '0.375rem 0.5rem',
  border: 'var(--border-w-2) solid var(--border-color)',
  borderRadius: 'var(--radius)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
  background: '#fff',
  boxSizing: 'border-box',
}

const BTN_ICON: React.CSSProperties = {
  padding: '0.3rem',
  border: 'none',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

export default function DynamicTable({
  name,
  columns,
  initialData,
  addLabel = '행 추가',
}: DynamicTableProps) {
  const [rows, setRows] = useState<Record<string, unknown>[]>(
    initialData.length > 0 ? initialData : [makeEmpty(columns)]
  )

  function makeEmpty(cols: ColumnDef[]): Record<string, unknown> {
    return Object.fromEntries(cols.map((c) => [c.key, c.type === 'tags' ? [] : '']))
  }

  function addRow() {
    setRows((prev) => [...prev, makeEmpty(columns)])
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateCell(idx: number, key: string, value: unknown) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)))
  }

  function updateTags(idx: number, key: string, raw: string) {
    const tags = raw.split(',').map((s) => s.trim()).filter(Boolean)
    updateCell(idx, key, tags)
  }

  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(rows)} />

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
          <thead>
            <tr style={{ background: 'var(--color-bg)', borderBottom: 'var(--border-w-2) solid var(--border-color)' }}>
              <th style={{ width: '32px', padding: '0.4rem' }} />
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    padding: '0.4rem 0.5rem',
                    textAlign: 'left',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    width: col.width,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col.label}
                </th>
              ))}
              <th style={{ width: '36px', padding: '0.4rem' }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={idx}
                style={{ borderBottom: 'var(--hairline) solid var(--surface-muted)' }}
              >
                <td
                  style={{
                    padding: '0.35rem',
                    color: 'var(--text-faint)',
                    fontSize: 'var(--fs-xs)',
                    textAlign: 'center',
                  }}
                >
                  {idx + 1}
                </td>
                {columns.map((col) => (
                  <td key={col.key} style={{ padding: '0.35rem 0.3rem', verticalAlign: 'top' }}>
                    {col.type === 'textarea' ? (
                      <textarea
                        value={(row[col.key] as string) || ''}
                        onChange={(e) => updateCell(idx, col.key, e.target.value)}
                        placeholder={col.placeholder}
                        rows={2}
                        style={{ ...INPUT, resize: 'vertical', minHeight: '3.5rem' }}
                      />
                    ) : col.type === 'tags' ? (
                      <input
                        type="text"
                        value={((row[col.key] as string[]) || []).join(', ')}
                        onChange={(e) => updateTags(idx, col.key, e.target.value)}
                        placeholder={col.placeholder || '쉼표로 구분'}
                        style={INPUT}
                      />
                    ) : (
                      <input
                        type={col.type === 'number' ? 'number' : 'text'}
                        value={(row[col.key] as string | number) ?? ''}
                        onChange={(e) =>
                          updateCell(
                            idx,
                            col.key,
                            col.type === 'number' ? Number(e.target.value) : e.target.value
                          )
                        }
                        placeholder={col.placeholder}
                        style={INPUT}
                      />
                    )}
                  </td>
                ))}
                <td style={{ padding: '0.35rem', textAlign: 'center', verticalAlign: 'top' }}>
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    style={{ ...BTN_ICON, background: 'var(--danger-bg)', color: 'var(--danger)' }}
                    title="행 삭제"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={addRow}
        style={{
          marginTop: '0.625rem',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.375rem',
          padding: '0.375rem 0.75rem',
          border: 'var(--hairline) dashed var(--brand-soft-2)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--brand-soft)',
          color: 'var(--brand)',
          fontSize: 'var(--fs-sm)',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        <Plus size={13} />
        {addLabel}
      </button>
    </div>
  )
}
