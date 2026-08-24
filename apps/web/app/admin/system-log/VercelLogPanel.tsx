'use client'

// app/admin/system-log/VercelLogPanel.tsx — 배포 로그를 **우리 화면 안에서** 읽는다
//
// ## 왜 만들었나
//
// 예전엔 이 화면 오른쪽 위에 「Vercel 로그 열기」 외부 링크 하나뿐이었다.
// 누르면 우리 화면을 나가고, 나가는 순간 여기서 보던 맥락 — 무엇이 언제부터 몇 번 실패했나 —
// 이 끊긴다. 관리자는 두 화면을 눈으로 맞춰 봐야 했다.
//
// ## 우리 기록과 무엇이 다른가 (탭을 나눈 이유)
//
// `system_events` 는 **우리가 쓴 사건**이다 — 사실 문장이 저장 시점에 확정돼 있다.
// Vercel 로그는 **그 아래 인프라 계층**이다(빌드·콜드스타트·504). 성격이 달라서 한 목록에 섞으면
// 같은 실패가 두 줄로 보이거나, 서로 다른 것이 한 줄로 접힌다.
//
// 목록 표준(§2-6) 그대로다 — ListToolbar + ListSurface + useListQuery. 새 부품을 만들지 않았다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import InlineError from '@/components/ui/InlineError'
import type { ColumnDef, ListFilterDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import type { DeployRow, LogRow } from '@/lib/vercel/normalize'
import styles from './system-log.module.css'

type Kind = 'runtime' | 'deployments'
type Row = (LogRow | DeployRow) & { id: string }

interface Payload {
  configured?: boolean
  reason?: string
  items?: Row[]
  notice?: string | null
  capped?: boolean
  scanned?: number
  deploymentUrl?: string | null
  error?: { message: string }
}

const LEVEL_FILTER: ListFilterDef = {
  key: 'level', label: '심각도',
  options: [
    { value: 'fatal', label: '치명' },
    { value: 'error', label: '실패' },
    { value: 'warning', label: '주의' },
  ],
}

const TARGET_FILTER: ListFilterDef = {
  key: 'target', label: '환경',
  options: [{ value: 'production', label: '프로덕션만' }],
}

export default function VercelLogPanel({ kind }: { kind: Kind }) {
  const { query, set, queryKey } = useListQuery({
    view: 'table', size: 20, sort: { key: 'at', dir: 'desc' }, mode: 'more',
    filterKeys: kind === 'runtime' ? ['level', 'all'] : ['target'],
  }, { persistKey: `/admin/system-log:${kind}` })

  const [payload, setPayload] = useState<Payload>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  const q = query.q.trim().toLowerCase()
  const level = query.filters?.level ?? ''
  const target = query.filters?.target ?? ''
  const showAll = query.filters?.all === '1'

  const load = useCallback(async () => {
    void queryKey
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams({ kind })
      sp.set('limit', String(query.size))
      if (kind === 'deployments' && target) sp.set('target', target)
      if (kind === 'runtime' && showAll) sp.set('all', '1')
      const res = await fetch(`/api/admin/vercel-logs?${sp}`)
      const body = (await res.json()) as Payload
      if (!res.ok) {
        setError(body?.error?.message ?? '배포 로그를 불러오지 못했습니다.')
        setPayload({ configured: body?.configured })
        return
      }
      setPayload(body)
    } catch {
      setError('배포 로그를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [queryKey, kind, query.size, target, showAll])

  useEffect(() => { void load() }, [load])

  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  /**
   * 검색·심각도는 **받아 온 것 안에서** 거른다.
   * Vercel 런타임 로그 endpoint 는 검색을 받지 않는다 — 서버에 넘기는 척하면
   * "검색했는데 왜 그대로지"가 된다. 거른 결과 수를 도구줄이 그대로 보여 준다.
   */
  const rows = useMemo(() => {
    let items = payload.items ?? []
    if (kind === 'runtime' && level) items = items.filter((r) => (r as LogRow).level === level)
    if (!q) return items
    return items.filter((r) => JSON.stringify(r).toLowerCase().includes(q))
  }, [payload.items, kind, level, q])

  const columns = useMemo<ColumnDef<Row>[]>(
    () => (kind === 'runtime' ? runtimeColumns(open, toggle) : deployColumns(open, toggle)),
    [kind, open, toggle],
  )

  // 연동 전이면 목록을 그리지 않는다 — 빈 표는 "로그가 없다"는 **틀린 사실**을 말한다
  if (!loading && payload.configured === false) {
    return (
      <EmptyState
        title="Vercel이 아직 연결되지 않았습니다"
        description={payload.notice ?? '시스템 설정 → 외부 연동에서 Vercel 토큰과 프로젝트를 넣으면 여기에서 바로 보입니다.'}
        action={{ label: '연동 설정으로', href: '/admin/settings?tab=integrations' }}
      />
    )
  }

  return (
    <>
      {payload.notice && <InlineError compact>{payload.notice}</InlineError>}

      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder={kind === 'runtime' ? '경로·내용으로 검색' : '커밋·브랜치로 검색'}
        views={['table', 'card']}
        filters={kind === 'runtime' ? [LEVEL_FILTER, ALL_FILTER] : [TARGET_FILTER]}
        total={loading ? undefined : rows.length}
        actions={payload.deploymentUrl ? (
          <a className="btn-ghost" href={payload.deploymentUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} /> 배포 열기
          </a>
        ) : undefined}
      />

      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        onChange={set}
        rowKey={(r) => r.id}
        loading={loading && rows.length === 0}
        error={error ? { message: error, onRetry: () => void load() } : null}
        empty={{
          title: kind === 'runtime'
            ? (showAll ? '기록된 로그가 없어요' : '최근 서버 오류가 없어요')
            : '배포 기록이 없어요',
          description: kind === 'runtime'
            ? (showAll
              ? 'Vercel은 최근 것만 보관합니다. 오래된 것은 Vercel에서 확인해 주세요.'
              : '실패만 골라 보고 있습니다. 「전체 보기」를 켜면 정상 요청까지 함께 나옵니다.')
            : '이 프로젝트에 아직 배포가 없습니다.',
        }}
        renderExpanded={(r) => (open.has(r.id)
          ? (kind === 'runtime' ? <LogDetail row={r as LogRow} /> : <DeployDetail row={r as DeployRow} />)
          : null)}
      />
    </>
  )
}

/** 기본은 실패만 본다 — 이 화면의 전제가 "무엇이 안 됐나"다 */
const ALL_FILTER: ListFilterDef = {
  key: 'all', label: '보기',
  options: [{ value: '1', label: '정상 요청까지' }],
}

/* ── 컬럼 ──────────────────────────────────────────────────── */

function moreColumn(open: Set<string>, toggle: (id: string) => void): ColumnDef<Row> {
  return {
    key: 'more', header: '자세히', noLabel: true, align: 'right',
    cell: (r) => (
      <span onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
        <NbButton variant="ghost" onClick={() => toggle(r.id)}>
          {open.has(r.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {open.has(r.id) ? '접기' : '자세히'}
        </NbButton>
      </span>
    ),
  }
}

function runtimeColumns(open: Set<string>, toggle: (id: string) => void): ColumnDef<Row>[] {
  return [
    {
      key: 'message', header: '무슨 일', primary: true,
      cell: (row) => {
        const r = row as LogRow
        return (
          <span style={{ display: 'grid', gap: 'var(--space-1)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <NbBadge status={r.status}>{r.levelLabel}</NbBadge>
              <strong style={{ color: 'var(--text)' }}>
                {[r.method, r.path].filter(Boolean).join(' ') || '(경로 없음)'}
              </strong>
              {r.status_ > 0 && <NbBadge status={r.status_ >= 400 ? 'blocker' : 'note'}>{r.status_}</NbBadge>}
            </span>
            <span className={styles.logLine}>{firstLine(r.message) || '(내용 없음)'}</span>
            <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>
              {formatKstDateTimeShort(r.at)} · {r.sourceLabel}
            </span>
          </span>
        )
      },
    },
    { key: 'sourceLabel', header: '위치', cell: (r) => (r as LogRow).sourceLabel, hideOnCard: true },
    moreColumn(open, toggle),
  ]
}

function deployColumns(open: Set<string>, toggle: (id: string) => void): ColumnDef<Row>[] {
  return [
    {
      key: 'state', header: '배포', primary: true,
      cell: (row) => {
        const r = row as DeployRow
        return (
          <span style={{ display: 'grid', gap: 'var(--space-1)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <NbBadge status={r.status}>{r.stateLabel}</NbBadge>
              <strong style={{ color: 'var(--text)' }}>{r.commitMessage ?? '(커밋 메시지 없음)'}</strong>
            </span>
            <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>
              {[formatKstDateTimeShort(r.at), r.branch, r.author, r.target].filter(Boolean).join(' · ')}
            </span>
          </span>
        )
      },
    },
    { key: 'target', header: '환경', cell: (r) => (r as DeployRow).target, hideOnCard: true },
    moreColumn(open, toggle),
  ]
}

/* ── 펼친 줄 ───────────────────────────────────────────────── */

function LogDetail({ row }: { row: LogRow }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)', padding: 'var(--space-3) 0' }}>
      <pre className={styles.raw}>{row.message || '내용이 없습니다.'}</pre>
      {row.truncated && (
        <p className={styles.detailNote}>내용이 길어 잘렸습니다. 전체는 Vercel에서 확인해 주세요.</p>
      )}
    </div>
  )
}

function DeployDetail({ row }: { row: DeployRow }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)', padding: 'var(--space-3) 0' }}>
      {row.errorMessage && <pre className={styles.raw}>{row.errorMessage}</pre>}
      <p className={styles.detailNote}>
        {[row.branch ? `브랜치 ${row.branch}` : null, row.author ? `올린 사람 ${row.author}` : null]
          .filter(Boolean).join(' · ') || '커밋 정보가 없습니다.'}
      </p>
      <span style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {row.url && (
          <a className="btn-ghost" href={row.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} /> 이 배포 열기
          </a>
        )}
        {row.inspectorUrl && (
          <a className="btn-ghost" href={row.inspectorUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} /> Vercel에서 빌드 로그 보기
          </a>
        )}
      </span>
    </div>
  )
}

/** 목록 줄에는 첫 줄만. 스택 전체가 들어오면 한 건이 목록을 다 먹는다 */
function firstLine(text: string): string {
  const line = (text ?? '').split('\n')[0] ?? ''
  return line.length > 200 ? `${line.slice(0, 200)}…` : line
}
