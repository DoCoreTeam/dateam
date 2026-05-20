'use client'

import { useState, useTransition } from 'react'
import { Pencil, Trash2, Check, X } from 'lucide-react'
import { deleteKpi, updateKpi } from './actions'
import type { KpiEntry } from '@/types/database'

const INPUT: React.CSSProperties = {
  padding: '0.25rem 0.5rem',
  border: '1px solid #c7d2fe',
  borderRadius: '0.3rem',
  fontSize: '0.8125rem',
  color: '#0f172a',
  background: '#fff',
  width: '100%',
}

export default function KpiRow({ entry }: { entry: KpiEntry }) {
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    metric_name: entry.metric_name,
    value: String(entry.value),
    unit: entry.unit ?? '',
    period_start: entry.period_start,
    period_end: entry.period_end,
  })

  function handleSave() {
    startTransition(async () => {
      await updateKpi(entry.id, {
        metric_name: form.metric_name,
        value: parseFloat(form.value),
        unit: form.unit,
        period_start: form.period_start,
        period_end: form.period_end,
      })
      setEditing(false)
    })
  }

  function handleDelete() {
    if (!confirm('이 KPI 항목을 삭제하시겠습니까?')) return
    startTransition(async () => { await deleteKpi(entry.id) })
  }

  function upd(f: keyof typeof form, v: string) {
    setForm((prev) => ({ ...prev, [f]: v }))
  }

  if (editing) {
    return (
      <tr style={{ background: '#f0f9ff', opacity: pending ? 0.5 : 1 }}>
        <td style={{ padding: '0.4rem 0.75rem' }}>
          <input value={form.metric_name} onChange={(e) => upd('metric_name', e.target.value)} style={INPUT} />
        </td>
        <td style={{ padding: '0.4rem 0.5rem' }}>
          <input type="number" value={form.value} onChange={(e) => upd('value', e.target.value)} style={{ ...INPUT, width: '80px' }} />
        </td>
        <td style={{ padding: '0.4rem 0.5rem' }}>
          <input value={form.unit} onChange={(e) => upd('unit', e.target.value)} style={{ ...INPUT, width: '60px' }} />
        </td>
        <td style={{ padding: '0.4rem 0.5rem' }}>
          <input type="date" value={form.period_start} onChange={(e) => upd('period_start', e.target.value)} style={INPUT} />
        </td>
        <td style={{ padding: '0.4rem 0.5rem' }}>
          <input type="date" value={form.period_end} onChange={(e) => upd('period_end', e.target.value)} style={INPUT} />
        </td>
        <td style={{ padding: '0.4rem 0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              onClick={handleSave}
              disabled={pending}
              style={{ padding: '0.3rem 0.5rem', background: '#6366f1', color: '#fff', border: 'none', borderRadius: '0.3rem', cursor: 'pointer', display: 'flex' }}
            >
              <Check size={13} />
            </button>
            <button
              onClick={() => setEditing(false)}
              style={{ padding: '0.3rem 0.5rem', background: '#e2e8f0', color: '#475569', border: 'none', borderRadius: '0.3rem', cursor: 'pointer', display: 'flex' }}
            >
              <X size={13} />
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr style={{ borderBottom: '1px solid #f1f5f9', opacity: pending ? 0.5 : 1 }}>
      <td style={{ padding: '0.75rem', fontSize: '0.875rem', fontWeight: 500, color: '#0f172a' }}>
        {entry.metric_name}
      </td>
      <td style={{ padding: '0.75rem', fontSize: '0.875rem', color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
        {entry.value.toLocaleString()}
      </td>
      <td style={{ padding: '0.75rem', fontSize: '0.875rem', color: '#64748b' }}>
        {entry.unit || '—'}
      </td>
      <td style={{ padding: '0.75rem', fontSize: '0.8125rem', color: '#64748b' }}>
        {entry.period_start}
      </td>
      <td style={{ padding: '0.75rem', fontSize: '0.8125rem', color: '#64748b' }}>
        {entry.period_end}
      </td>
      <td style={{ padding: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          <button
            onClick={() => setEditing(true)}
            title="수정"
            style={{ padding: '0.3rem 0.5rem', border: '1px solid #c7d2fe', borderRadius: '0.375rem', background: '#eef2ff', color: '#6366f1', cursor: 'pointer', display: 'flex' }}
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={handleDelete}
            title="삭제"
            style={{ padding: '0.3rem 0.5rem', border: '1px solid #fecaca', borderRadius: '0.375rem', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', display: 'flex' }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  )
}
