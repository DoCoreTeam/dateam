'use client'

// app/admin/system-log/SystemLogClient.tsx — 시스템 로그 한 화면
//
// ## 이 화면을 지배하는 판단
//
// **사실 문장에는 AI 를 쓰지 않는다.** 이 화면이 필요해진 이유가 "AI 한도가 없으면 그런 걸 체크"인데,
// 문장을 AI 가 만들면 한도가 바닥난 바로 그 순간 화면이 통째로 빈다 —
// 관측 도구가 관측 대상과 함께 죽는다. AI 는 **[해결 방법 보기]** 를 눌렀을 때만 쓴다.
//
// 목록 표준(§2-6) 그대로다 — ListToolbar + ListSurface + ListPager + useListQuery.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import InlineError from '@/components/ui/InlineError'
import type { ColumnDef, ListFilterDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import { REASON_LABELS, SOURCE_LABELS } from '@/lib/system-log/labels'
import type { StatusKey } from '@/lib/tokens/status-colors'
import RemedyPanel from './RemedyPanel'
import styles from './system-log.module.css'

export interface EventGroup {
  id: string
  fingerprint: string
  severity: 'critical' | 'error' | 'warn'
  reason: string
  reasonLabel: string
  source: string
  sourceLabel: string
  featureLabel: string | null
  headline: string
  detail: string
  route: string | null
  raw: string | null
  count: number
  firstAt: string
  lastAt: string
  actorCount: number | null
  actorSample: string | null
  resolvedAt: string | null
}

/**
 * 심각도는 색이 아니라 **말**로도 구분된다 — 색만 쓰면 흑백 출력·색각에서 사라진다.
 * 색은 뱃지의 상태 토큰(`StatusKey`)에 맡긴다 — 화면에서 색맵을 다시 만들지 않는다(§1).
 */
const SEVERITY: Record<string, { label: string; status: StatusKey }> = {
  critical: { label: '지금 막힘', status: 'blocker' },
  error: { label: '실패', status: 'blocker' },
  warn: { label: '주의', status: 'note' },
}

const FILTERS: ListFilterDef[] = [
  {
    key: 'reason', label: '원인',
    options: Object.entries(REASON_LABELS).map(([value, label]) => ({ value, label })),
  },
  {
    key: 'source', label: '발생 위치',
    options: Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label })),
  },
  {
    key: 'resolved', label: '보기',
    options: [{ value: '1', label: '처리한 것까지' }],
  },
]

export default function SystemLogClient() {
  const { query, set, queryKey } = useListQuery({
    view: 'table', size: 20, sort: { key: 'lastAt', dir: 'desc' }, mode: 'more',
    filterKeys: ['reason', 'source', 'resolved'],
  }, { persistKey: '/admin/system-log' })

  const [rows, setRows] = useState<EventGroup[]>([])
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [capped, setCapped] = useState(false)
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  const q = query.q.trim()

  const load = useCallback(async () => {
    // 조회 조건의 서명. 아래는 개별 필드를 읽지만, **기본값으로 되돌리는 조작**은
    // 주소가 그대로라 개별 필드로는 보이지 않는다 — 그 변화는 queryKey 로만 들어온다.
    void queryKey
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      if (q) sp.set('q', q)
      if (query.filters?.reason) sp.set('reason', query.filters.reason)
      if (query.filters?.source) sp.set('source', query.filters.source)
      if (query.filters?.resolved) sp.set('resolved', '1')
      sp.set('limit', String(query.size))
      const res = await fetch(`/api/admin/system-log?${sp}`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '시스템 로그를 불러오지 못했습니다.'); return }
      setRows(body.items ?? [])
      setTotal(body.total)
      setNotice(body.notice ?? null)
      setCapped(Boolean(body.capped))
    } catch {
      setError('시스템 로그를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [queryKey, q, query.filters?.reason, query.filters?.source, query.filters?.resolved, query.size])

  useEffect(() => { void load() }, [load])

  const toggle = useCallback((fp: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      next.has(fp) ? next.delete(fp) : next.add(fp)
      return next
    })
  }, [])

  const resolve = useCallback(async (fp: string, undo: boolean) => {
    await fetch('/api/admin/system-log/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint: fp, undo }),
    }).catch(() => {})
    await load()
  }, [load])

  /**
   * 맨 위 "지금 막혀 있는 것" — **AI 를 쓰지 않는다.**
   * 관리자가 화면을 열자마자 3초 안에 알아야 하는 것은 "지금 뭐가 안 되나" 하나다.
   */
  const blocking = useMemo(
    () => rows.filter((r) => r.severity === 'critical' && !r.resolvedAt),
    [rows],
  )

  const columns = useMemo<ColumnDef<EventGroup>[]>(() => [
    {
      key: 'headline', header: '무슨 일', primary: true,
      cell: (r) => (
        <span style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <NbBadge status={SEVERITY[r.severity]?.status ?? 'note'}>
              {SEVERITY[r.severity]?.label ?? r.severity}
            </NbBadge>
            <strong style={{ color: 'var(--text)' }}>{r.headline}</strong>
            {r.resolvedAt && <NbBadge status="done">처리함</NbBadge>}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{r.detail}</span>
          <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>
            {[
              r.actorSample
                ? (r.actorCount && r.actorCount > 1 ? `${r.actorSample} 외 ${r.actorCount - 1}명` : r.actorSample)
                : null,
              r.count > 1
                ? `${formatKstDateTimeShort(r.firstAt)}부터 ${r.count.toLocaleString()}번`
                : formatKstDateTimeShort(r.lastAt),
              r.route,
            ].filter(Boolean).join(' · ')}
          </span>
        </span>
      ),
    },
    { key: 'reasonLabel', header: '원인', cell: (r) => r.reasonLabel },
    { key: 'sourceLabel', header: '위치', cell: (r) => r.featureLabel ?? r.sourceLabel, hideOnCard: true },
    {
      key: 'more', header: '자세히', noLabel: true, align: 'right',
      cell: (r) => (
        <span onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
          <NbButton variant="ghost" onClick={() => toggle(r.fingerprint)}>
            {open.has(r.fingerprint) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {open.has(r.fingerprint) ? '접기' : '자세히'}
          </NbButton>
        </span>
      ),
    },
  ], [open, toggle])

  return (
    <>
      {notice && <InlineError banner>{notice}</InlineError>}

      {/* 지금 막혀 있는 것 — AI 없이, 항상 */}
      {blocking.length > 0 && (
        <div className={`card ${styles.blocking}`}>
          <p className={styles.blockingTitle}>지금 막혀 있는 것 {blocking.length}건</p>
          <ul className={styles.blockingList}>
            {blocking.slice(0, 5).map((b) => (
              <li key={b.fingerprint}>{b.headline} — {b.detail}</li>
            ))}
          </ul>
          {blocking.length > 5 && (
            <p className={styles.blockingMore}>외 {blocking.length - 5}건이 더 있습니다.</p>
          )}
        </div>
      )}

      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="내용·원문으로 검색"
        views={['table', 'card']}
        filters={FILTERS}
        total={loading ? undefined : total}
      />

      {capped && (
        <InlineError compact>
          최근 사건이 많아 일부만 훑었습니다. 기간이나 원인으로 좁혀 보세요.
        </InlineError>
      )}

      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        onChange={set}
        rowKey={(r) => r.fingerprint}
        loading={loading && rows.length === 0}
        error={error ? { message: error, onRetry: () => void load() } : null}
        empty={{
          title: q || query.filters?.reason ? '조건에 맞는 기록이 없어요' : '아직 기록된 실패가 없어요',
          description: q || query.filters?.reason
            ? '검색어나 원인을 바꿔 보세요.'
            : '시스템에서 실패가 나면 여기에 사람이 읽을 수 있는 말로 쌓입니다.',
        }}
        renderExpanded={(r) => (open.has(r.fingerprint) ? (
          <EventDetail row={r} onResolve={resolve} />
        ) : null)}
      />
    </>
  )
}

/** 펼친 줄 — 원문은 감추지 않고 접어 둔다. 요약이 틀렸을 때 확인할 유일한 단서다 */
function EventDetail({ row, onResolve }: {
  row: EventGroup
  onResolve: (fp: string, undo: boolean) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-3) 0' }}>
      <RemedyPanel fingerprint={row.fingerprint} reason={row.reason} />

      <details>
        <summary className={styles.rawSummary}>원문 보기</summary>
        <pre className={styles.raw}>{row.raw ?? '원문이 없습니다.'}</pre>
      </details>

      <div>
        <NbButton
          variant={row.resolvedAt ? 'ghost' : 'secondary'}
          onClick={async () => { setBusy(true); await onResolve(row.fingerprint, Boolean(row.resolvedAt)); setBusy(false) }}
          disabled={busy}
        >
          {busy ? <AXDotLoader /> : row.resolvedAt ? <RotateCcw size={14} /> : <Check size={14} />}
          {row.resolvedAt ? '처리 취소' : '처리함'}
        </NbButton>
        <span style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          처리해도 같은 일이 다시 나면 목록에 되살아납니다.
        </span>
      </div>
    </div>
  )
}

