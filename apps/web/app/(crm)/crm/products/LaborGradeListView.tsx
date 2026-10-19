'use client'

// 가격 기준 > 인건비 등급
//
// 등급 단가의 원천이다. 판매 단가가 없으면 견적 엔진이 공표 노임단가로 채운다.
// 원가 칸은 원가 보기 권한이 있을 때만 서버가 싣는다 — 화면은 받은 것만 그린다.
// 지우지 않고 숨긴다. 쓴 견적이 이 등급을 가리킨다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, EyeOff, Eye } from 'lucide-react'
import Sensitive from '@/components/crm/Sensitive'
import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import { ACTION, PRICEBOOK } from '@/lib/terms'
import { useListQuery } from '@/lib/ui/use-list-query'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import LaborGradeEditModal, { type GradeDraft } from './LaborGradeEditModal'
import styles from './pricebook.module.css'

export interface GradeRow {
  id: string
  name: string
  roleLabel: string | null
  pricePerMmMinor: string | null
  publicRateMinor: string | null
  costPerMmMinor?: string
  effectiveFrom: string | null
  position: number
  isActive: boolean
  version: number
}

const ENDPOINT = '/api/crm/labor-grades'

function money(v: string | null | undefined) {
  if (v === null || v === undefined) return <span className={styles.faint}>—</span>
  return <Sensitive>{formatAmount(v, 'KRW')}</Sensitive>
}

export default function LaborGradeListView() {
  const { query, set } = useListQuery({ view: 'table', size: 50, sort: { key: 'position', dir: 'asc' }, mode: 'more' })
  const [rows, setRows] = useState<GradeRow[]>([])
  const [canSeeCost, setCanSeeCost] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<GradeDraft | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${ENDPOINT}?all=1`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '등급을 불러오지 못했습니다.'); return }
      setRows(body.items ?? [])
      setCanSeeCost(Boolean(body.canSeeCost))
    } catch {
      setError('등급을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggle = useCallback(async (r: GradeRow) => {
    setActionError(null)
    try {
      const res = r.isActive
        ? await fetch(`${ENDPOINT}/${r.id}`, { method: 'DELETE' })
        : await fetch(`${ENDPOINT}/${r.id}/restore`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) { setActionError(body?.error?.message ?? '바꾸지 못했습니다.'); return }
      await load()
    } catch {
      setActionError('바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }, [load])

  const columns = useMemo<ColumnDef<GradeRow>[]>(() => [
    {
      key: 'name', header: PRICEBOOK.gradeName, primary: true,
      cell: (r) => (
        <>
          <b>{r.name}</b>
          {!r.isActive && <span style={{ marginLeft: 'var(--space-2)' }}><NbBadge status="note">{ACTION.hide}</NbBadge></span>}
        </>
      ),
    },
    { key: 'role', header: PRICEBOOK.gradeRole, cell: (r) => r.roleLabel ?? <span className={styles.faint}>—</span> },
    { key: 'price', header: PRICEBOOK.gradePrice, cell: (r) => money(r.pricePerMmMinor) },
    { key: 'public', header: PRICEBOOK.gradePublic, cell: (r) => money(r.publicRateMinor) },
    ...(canSeeCost ? [{ key: 'cost', header: PRICEBOOK.gradeCost, cell: (r: GradeRow) => money(r.costPerMmMinor ?? null) }] : []),
    { key: 'from', header: PRICEBOOK.gradeFrom, hideOnCard: true, cell: (r) => r.effectiveFrom ?? <span className={styles.faint}>—</span> },
    {
      key: 'actions', header: '', noLabel: true,
      cell: (r) => (
        <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
          <NbButton variant="ghost" onClick={() => void toggle(r)}>
            {r.isActive ? <><EyeOff size={14} /> {ACTION.hide}</> : <><Eye size={14} /> {ACTION.unhide}</>}
          </NbButton>
        </div>
      ),
    },
  ], [canSeeCost, toggle])

  return (
    <>
      <div className={styles.actions} style={{ marginBottom: 'var(--space-3)' }}>
        <NbButton onClick={() => setEditing(emptyDraft(rows.length))}><Plus size={14} /> {PRICEBOOK.newGrade}</NbButton>
      </div>
      {actionError && <p role="alert" className={styles.alert}>{actionError}</p>}
      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        onChange={set}
        rowKey={(r) => r.id}
        onRowClick={(r) => setEditing(toDraft(r))}
        loading={loading && rows.length === 0}
        error={error ? { message: error, onRetry: () => void load() } : null}
        empty={{
          title: '인건비 등급이 아직 없어요',
          description: '등급이 없으면 공수 견적은 공표 노임단가로 채워져요. 공표 노임단가 파일을 올리거나 등급을 만드세요.',
          action: { label: PRICEBOOK.newGrade, onClick: () => setEditing(emptyDraft(0)) },
        }}
      />
      {editing && (
        <LaborGradeEditModal
          draft={editing}
          canSeeCost={canSeeCost}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load() }}
        />
      )}
    </>
  )
}

function toDraft(r: GradeRow): GradeDraft {
  return {
    id: r.id, version: r.version, name: r.name, roleLabel: r.roleLabel ?? '',
    pricePerMmMinor: r.pricePerMmMinor ?? '', publicRateMinor: r.publicRateMinor ?? '',
    costPerMmMinor: r.costPerMmMinor ?? '', effectiveFrom: r.effectiveFrom ?? '', position: String(r.position),
  }
}

function emptyDraft(position: number): GradeDraft {
  return { id: null, version: 0, name: '', roleLabel: '', pricePerMmMinor: '', publicRateMinor: '', costPerMmMinor: '', effectiveFrom: '', position: String(position) }
}
