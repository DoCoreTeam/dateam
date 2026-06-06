'use client'

import { useState, useTransition } from 'react'
import { Pencil, Trash2, Check, X } from 'lucide-react'
import { deleteKpi, updateKpi } from './actions'
import type { KpiEntry } from '@/types/database'

interface WeeklyKpiTarget {
  label: string
  target: string
  unit?: string
}

const INPUT: React.CSSProperties = {
  padding: '0.25rem 0.5rem',
  border: '1px solid #c7d2fe',
  borderRadius: '0.3rem',
  fontSize: '0.8125rem',
  color: '#0f172a',
  background: '#fff',
  width: '100%',
}

export default function KpiRow({
  entry,
  weeklyTargets = [],
  h1Kpi = [],
  yearKpi = [],
}: {
  entry: KpiEntry
  weeklyTargets?: WeeklyKpiTarget[]
  h1Kpi?: string[]
  yearKpi?: string[]
}) {
  const hasDropdown = weeklyTargets.length > 0 || h1Kpi.length > 0 || yearKpi.length > 0

  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    metric_name: entry.metric_name,
    value: String(entry.value),
    unit: entry.unit ?? '',
    period_start: entry.period_start,
    period_end: entry.period_end,
  })

  function handleMetricChange(ref: string) {
    const [source, idxStr] = ref.split(':')
    const i = parseInt(idxStr, 10)
    if (source === 'kpi_targets') {
      const t = weeklyTargets[i]
      if (!t) return
      setForm((prev) => ({ ...prev, metric_name: t.label, unit: t.unit ?? '' }))
    } else if (source === 'h1_kpi') {
      const item = h1Kpi[i]
      if (!item) return
      setForm((prev) => ({ ...prev, metric_name: item, unit: '' }))
    } else if (source === 'year_kpi') {
      const item = yearKpi[i]
      if (!item) return
      setForm((prev) => ({ ...prev, metric_name: item, unit: '' }))
    }
  }

  function currentRef(): string {
    const wi = weeklyTargets.findIndex((t) => t.label === form.metric_name)
    if (wi >= 0) return `kpi_targets:${wi}`
    const hi = h1Kpi.findIndex((t) => t === form.metric_name)
    if (hi >= 0) return `h1_kpi:${hi}`
    const yi = yearKpi.findIndex((t) => t === form.metric_name)
    if (yi >= 0) return `year_kpi:${yi}`
    return ''
  }

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
    if (!confirm('이 실적을 삭제하시겠습니까?')) return
    startTransition(async () => { await deleteKpi(entry.id) })
  }

  function upd(f: keyof typeof form, v: string) {
    setForm((prev) => ({ ...prev, [f]: v }))
  }

  if (editing) {
    return (
      <tr style={{ background: '#f0f9ff', opacity: pending ? 0.5 : 1 }}>
        <td style={{ padding: '0.4rem 0.75rem' }} className="card-header">
          {hasDropdown ? (
            <select
              value={currentRef()}
              onChange={(e) => handleMetricChange(e.target.value)}
              style={INPUT}
            >
              {weeklyTargets.length > 0 && (
                <optgroup label="주간 KPI">
                  {weeklyTargets.map((kpi, i) => (
                    <option key={i} value={`kpi_targets:${i}`}>{kpi.label}</option>
                  ))}
                </optgroup>
              )}
              {h1Kpi.length > 0 && (
                <optgroup label="상반기 KPI (H1)">
                  {h1Kpi.map((item, i) => (
                    <option key={i} value={`h1_kpi:${i}`}>{item}</option>
                  ))}
                </optgroup>
              )}
              {yearKpi.length > 0 && (
                <optgroup label="연간 KPI">
                  {yearKpi.map((item, i) => (
                    <option key={i} value={`year_kpi:${i}`}>{item}</option>
                  ))}
                </optgroup>
              )}
            </select>
          ) : (
            <input value={form.metric_name} onChange={(e) => upd('metric_name', e.target.value)} style={INPUT} />
          )}
        </td>
        <td style={{ padding: '0.4rem 0.5rem' }} data-label="실적">
          <input
            type="number"
            value={form.value}
            onChange={(e) => upd('value', e.target.value)}
            style={{ ...INPUT, width: '80px' }}
          />
        </td>
        <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.8125rem', color: '#64748b' }} data-label="단위">
          {form.unit || '—'}
        </td>
        <td colSpan={1} style={{ padding: '0.4rem 0.5rem', fontSize: '0.75rem', color: '#94a3b8' }} data-label="주차">
          {form.period_start} ~ {form.period_end}
        </td>
        <td style={{ padding: '0.4rem 0.5rem' }} className="card-actions">
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              onClick={handleSave}
              disabled={pending}
              style={{ padding: '0.3rem 0.5rem', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: '0.3rem', cursor: 'pointer', display: 'flex' }}
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
      <td style={{ padding: '0.75rem', fontSize: '0.875rem', fontWeight: 500, color: '#0f172a' }} className="card-header">
        {entry.metric_name}
      </td>
      <td style={{ padding: '0.75rem', fontSize: '0.875rem', color: '#0f172a', fontVariantNumeric: 'tabular-nums' }} data-label="실적">
        {entry.value.toLocaleString()}
      </td>
      <td style={{ padding: '0.75rem', fontSize: '0.875rem', color: '#64748b' }} data-label="단위">
        {entry.unit || '—'}
      </td>
      <td style={{ padding: '0.75rem', fontSize: '0.8125rem', color: '#64748b' }} data-label="주차">
        {entry.period_start} ~ {entry.period_end}
      </td>
      <td style={{ padding: '0.75rem' }} className="card-actions">
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          <button
            onClick={() => setEditing(true)}
            title="수정"
            style={{ padding: '0.3rem 0.5rem', border: '1px solid #c7d2fe', borderRadius: '0.375rem', background: '#eef2ff', color: 'var(--brand)', cursor: 'pointer', display: 'flex' }}
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
