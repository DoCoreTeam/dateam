'use client'

// app/(member)/kpi/KpiHistoryTable.tsx — KPI 실적 히스토리(목록 표준 §2-6)
// 화면이 <table>을 직접 짜지 않는다: ColumnDef 한 벌로 표·카드를 함께 그리고,
// 검색·정렬·페이지는 URL(useListQuery)이 진실이다. 인라인 편집 상태만 이 컴포넌트가 쥔다.

import { useMemo, useState, useTransition } from 'react'
import { Pencil, Trash2, Check, X } from 'lucide-react'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults } from '@/lib/ui/list-query'
import { deleteKpi, updateKpi } from './actions'
import type { KpiEntry } from '@/types/database'

export interface WeeklyKpiTarget {
  label: string
  target: string
  unit?: string
}

interface Props {
  entries: KpiEntry[]
  weeklyTargets: WeeklyKpiTarget[]
  h1Kpi: string[]
  yearKpi: string[]
}

const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'period_end', dir: 'desc' },
  view: 'table',
}
const SORT_OPTIONS = [
  { key: 'period_end', label: '주차' },
  { key: 'metric_name', label: 'KPI 항목' },
  { key: 'value', label: '실적' },
]

interface EditForm {
  metric_name: string
  value: string
  unit: string
}

export default function KpiHistoryTable({ entries, weeklyTargets, h1Kpi, yearKpi }: Props) {
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/kpi' })
  const [pending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<EditForm>({ metric_name: '', value: '', unit: '' })

  const hasDropdown = weeklyTargets.length > 0 || h1Kpi.length > 0 || yearKpi.length > 0

  function startEdit(entry: KpiEntry) {
    setEditingId(entry.id)
    setForm({ metric_name: entry.metric_name, value: String(entry.value), unit: entry.unit ?? '' })
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

  function handleSave(entry: KpiEntry) {
    startTransition(async () => {
      await updateKpi(entry.id, {
        metric_name: form.metric_name,
        value: parseFloat(form.value),
        unit: form.unit,
        period_start: entry.period_start,
        period_end: entry.period_end,
      })
      setEditingId(null)
    })
  }

  function handleDelete(entry: KpiEntry) {
    if (!confirm('이 실적을 삭제하시겠습니까?')) return
    startTransition(async () => { await deleteKpi(entry.id) })
  }

  // 전량 보유 목록 — 검색·정렬은 여기서 접고, 화면 조건은 URL이 진실이다
  const filtered = useMemo(() => {
    const q = query.q.trim().toLowerCase()
    const rows = q ? entries.filter((e) => e.metric_name.toLowerCase().includes(q)) : entries
    const dir = query.sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (query.sort.key === 'metric_name') return a.metric_name.localeCompare(b.metric_name) * dir
      if (query.sort.key === 'value') return (a.value - b.value) * dir
      return a.period_end.localeCompare(b.period_end) * dir
    })
  }, [entries, query.q, query.sort.key, query.sort.dir])

  const { from, to } = rangeOf(query)
  const rows = filtered.slice(from, to + 1)

  const columns: ColumnDef<KpiEntry>[] = [
    {
      key: 'metric_name', header: 'KPI 항목', primary: true, sortable: 'metric_name',
      cell: (e) => editingId !== e.id
        ? <span style={{ fontWeight: 500, color: 'var(--text)' }}>{e.metric_name}</span>
        : hasDropdown ? (
          <select className="input-field" aria-label="KPI 항목" value={currentRef()} onChange={(ev) => handleMetricChange(ev.target.value)}>
            <option value="">직접 선택</option>
            {weeklyTargets.length > 0 && (
              <optgroup label="주간 KPI">
                {weeklyTargets.map((kpi, i) => <option key={i} value={`kpi_targets:${i}`}>{kpi.label}</option>)}
              </optgroup>
            )}
            {h1Kpi.length > 0 && (
              <optgroup label="상반기 KPI (H1)">
                {h1Kpi.map((item, i) => <option key={i} value={`h1_kpi:${i}`}>{item}</option>)}
              </optgroup>
            )}
            {yearKpi.length > 0 && (
              <optgroup label="연간 KPI">
                {yearKpi.map((item, i) => <option key={i} value={`year_kpi:${i}`}>{item}</option>)}
              </optgroup>
            )}
          </select>
        ) : (
          <input className="input-field" aria-label="KPI 항목" value={form.metric_name}
            onChange={(ev) => setForm((p) => ({ ...p, metric_name: ev.target.value }))} />
        ),
    },
    {
      key: 'value', header: '실적', sortable: 'value', align: 'right',
      cell: (e) => editingId !== e.id
        ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{e.value.toLocaleString()}</span>
        : <input className="input-field" type="number" aria-label="실적 값" value={form.value}
            onChange={(ev) => setForm((p) => ({ ...p, value: ev.target.value }))} style={{ maxWidth: '7rem' }} />,
    },
    {
      key: 'unit', header: '단위',
      cell: (e) => <span style={{ color: 'var(--text-muted)' }}>{(editingId === e.id ? form.unit : e.unit) || '—'}</span>,
    },
    {
      key: 'period_end', header: '주차', sortable: 'period_end',
      cell: (e) => <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{e.period_start} ~ {e.period_end}</span>,
    },
    {
      key: 'actions', header: '관리',
      cell: (e) => (
        <span style={{ display: 'inline-flex', gap: 'var(--space-1)', opacity: pending ? 0.5 : 1 }} onClick={(ev) => ev.stopPropagation()}>
          {editingId === e.id ? (
            <>
              <button type="button" className="btn-primary" onClick={() => handleSave(e)} disabled={pending} aria-label="저장">
                <Check size={13} />
              </button>
              <button type="button" className="btn-ghost" onClick={() => setEditingId(null)} aria-label="취소">
                <X size={13} />
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn-ghost" onClick={() => startEdit(e)} aria-label="수정" title="수정">
                <Pencil size={13} />
              </button>
              <button type="button" className="btn-ghost" onClick={() => handleDelete(e)} aria-label="삭제" title="삭제">
                <span style={{ display: 'inline-flex', color: 'var(--danger)' }}><Trash2 size={13} /></span>
              </button>
            </>
          )}
        </span>
      ),
    },
  ]

  return (
    <>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="KPI 항목 검색"
        sortOptions={SORT_OPTIONS}
        total={filtered.length}
      />
      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        rowKey={(e) => e.id}
        onChange={set}
        empty={query.q
          ? { title: '조건에 맞는 실적이 없어요', description: '검색어를 바꿔보세요' }
          : { title: '아직 등록된 실적이 없어요', description: '위 입력창에서 이번 주 실적을 기록해 보세요' }}
      />
      <ListPager query={query} total={filtered.length} onChange={set} />
    </>
  )
}
