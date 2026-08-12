// 업무 허브 통합 이력 탭 (프로젝트 현황 옆). 일일·주간·부서·프로젝트의 모든 활동을
// 한 피드로 최신순 표시 — 성공/실패/부분, 저장값 스냅샷, 실패 원인까지.
// 모듈·상태 필터와 '더 보기'는 URL이 진실(useListQuery) — 공유·새로고침·뒤로가기가 성립한다.
'use client'

import { useState, useCallback, useEffect, useTransition } from 'react'
import useSWRInfinite from 'swr/infinite'
import { AlertTriangle, Undo2 } from 'lucide-react'
import { restoreFromAudit, restoreProject } from '@/lib/work/restore-action'
import { restoreWeeklyReportSnapshot } from '@/app/(member)/weekly-report/actions'
import WorkPageShell from '@/components/ui/WorkPageShell'
import WorkSubTabs from '@/components/ui/WorkSubTabs'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import ListPager from '@/components/ui/list/ListPager'
import { useListQuery } from '@/lib/ui/use-list-query'
import type { ListDefaults } from '@/lib/ui/list-query'
import { fetcher } from '@/lib/swr-config'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import {
  MODULE_LABEL, ACTION_LABEL, STATUS_LABEL,
  type ActivityFeedItem, type ActivityStatus, type FeedModule, type RestoreRef,
} from '@/lib/work/activity-log'
import { diffSnapshots, diffWeeklyRows, type WeeklyRow } from '@/lib/work/activity-diff'

interface Page { items: ActivityFeedItem[]; hasMore: boolean; nextBefore: string | null }

const MODULES: { key: FeedModule; label: string }[] = [
  { key: 'daily', label: MODULE_LABEL.daily },
  { key: 'weekly', label: MODULE_LABEL.weekly },
  { key: 'dept_task', label: MODULE_LABEL.dept_task },
  { key: 'project', label: MODULE_LABEL.project },
]
const STATUS_TABS: { key: 'all' | ActivityStatus; label: string }[] = [
  { key: 'all', label: '전체' }, { key: 'success', label: '성공' },
  { key: 'failure', label: '실패' }, { key: 'partial', label: '부분' },
]
const STATUS_STYLE: Record<ActivityStatus, { color: string; bg: string; border: string }> = {
  success: { color: 'var(--success)', bg: 'var(--success-bg)', border: 'var(--success-border)' },
  failure: { color: 'var(--danger)', bg: 'var(--danger-bg)', border: 'var(--danger-border)' },
  partial: { color: 'var(--warning)', bg: 'var(--warning-bg)', border: 'var(--warning-border)' },
}
const MODULE_DOT: Record<FeedModule, string> = {
  daily: 'var(--brand)', weekly: 'var(--info)', dept_task: 'var(--warning)', project: 'var(--success)',
}

// 시간순 피드다 — 페이지 버튼보다 '더 보기'가 흐름을 안 끊는다(§2-6 (2)).
const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'occurredAt', dir: 'desc' },
  mode: 'more',
  view: 'card',
  filterKeys: ['status', 'module'],
}

export default function WorkActivityPage() {
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/work/activity' })
  const status = (query.filters.status as ActivityStatus | undefined) ?? 'all'
  // 모듈은 여러 개를 동시에 볼 수 있다 — URL에는 쉼표로 싣는다
  const mods = (query.filters.module ?? '').split(',').filter(Boolean) as FeedModule[]

  const getKey = useCallback((index: number, prev: Page | null) => {
    if (prev && (!prev.hasMore || !prev.nextBefore)) return null
    const sp = new URLSearchParams()
    if (index > 0 && prev?.nextBefore) sp.set('before', prev.nextBefore)
    mods.forEach((m) => sp.append('module', m))
    if (status !== 'all') sp.set('status', status)
    return `/api/work/activity?${sp.toString()}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.filters.module, status])

  // 최신 페이지(1페이지)를 반드시 재검증해야 방금 만든 활동이 즉시 뜬다.
  // (이전엔 revalidateFirstPage:false라 탭 재진입해도 새 활동이 영원히 안 보였음 — 이력 정지 사고)
  const { data, error, isLoading, size, setSize, isValidating, mutate } = useSWRInfinite<Page>(
    getKey, fetcher,
    { revalidateFirstPage: true, revalidateOnFocus: true, revalidateOnMount: true },
  )
  const [restoring, setRestoring] = useState<string | null>(null)   // 되살리는 중인 피드아이템 id
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null)
  const [, startRestore] = useTransition()

  // '더 보기'는 URL(page)이 진실이다 — 새로고침해도 보던 만큼 다시 불러온다
  useEffect(() => { if (size !== query.page) setSize(query.page) }, [query.page, size, setSize])

  // 모듈별 복원 인프라 분기 — audit(일일·부서)/weekly(스냅샷)/project. 성공 시 피드 즉시 갱신(실시간).
  function handleRestore(itemId: string, restore: RestoreRef) {
    if (restoring) return
    setRestoring(itemId); setRestoreMsg(null)
    startRestore(async () => {
      const res =
        restore.kind === 'audit' ? await restoreFromAudit(restore.ref)
        : restore.kind === 'weekly' ? await restoreWeeklyReportSnapshot(restore.ref)
        : await restoreProject(restore.ref)
      if (res.ok) { setRestoreMsg('되살렸습니다.'); await mutate() }
      else setRestoreMsg(res.error)
      setRestoring(null)
    })
  }

  const items = data ? data.flatMap((p) => p.items) : []
  const hasMore = data ? Boolean(data[data.length - 1]?.hasMore) : false

  function toggleMod(m: FeedModule) {
    const next = mods.includes(m) ? mods.filter((x) => x !== m) : [...mods, m]
    set({ filters: { module: next.join(',') } })
  }

  return (
    <WorkPageShell
      title="이력"
      description="일일·주간·부서·프로젝트의 모든 저장 활동을 한 곳에서 봅니다. 성공·실패 모두 기록됩니다."
      subTabs={
        <WorkSubTabs
          items={STATUS_TABS.map((s) => ({ key: s.key, label: s.label }))}
          activeKey={status}
          onSelect={(k) => set({ filters: { status: k === 'all' ? '' : k } })}
          ariaLabel="상태 필터"
        />
      }
    >
      {/* 모듈 필터 칩 */}
      <div className="work-activity-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {MODULES.map((m) => {
          const on = mods.includes(m.key)
          return (
            <button key={m.key} type="button" aria-pressed={on} onClick={() => toggleMod(m.key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', minHeight: 36,
                borderRadius: '9999px', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 600,
                background: on ? 'var(--brand-soft)' : 'var(--surface-bg)',
                color: on ? 'var(--brand)' : 'var(--text-muted)',
                border: `var(--hairline) solid ${on ? 'var(--brand)' : 'var(--border-color)'}`,
              }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: MODULE_DOT[m.key] }} />
              {m.label}
            </button>
          )
        })}
        {mods.length > 0 && (
          <button type="button" className="btn-ghost" onClick={() => set({ filters: { module: '' } })}
            style={{ fontSize: 'var(--fs-sm)', padding: 'var(--space-1) var(--space-3)' }}>필터 해제</button>
        )}
      </div>

      {restoreMsg && (
        <div role="status" style={{ marginBottom: 'var(--space-3)', padding: '0.5rem 0.8rem', borderRadius: 'var(--radius)', background: 'var(--brand-soft)', border: 'var(--hairline) solid var(--brand)', color: 'var(--brand)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>
          {restoreMsg}
        </div>
      )}

      {error ? (
        <ErrorState message="이력을 불러오지 못했습니다" onRetry={() => { void mutate() }} />
      ) : isLoading ? (
        <SkelList rows={6} />
      ) : items.length === 0 ? (
        <EmptyState
          title="기록된 활동 이력이 없습니다"
          description={mods.length > 0 || status !== 'all'
            ? '필터를 풀면 더 많은 활동이 보입니다'
            : '일일업무·주간보고를 저장하면 여기에 기록이 쌓입니다'}
          action={mods.length > 0 || status !== 'all'
            ? { label: '필터 해제', onClick: () => set({ filters: { module: '', status: '' } }) }
            : { label: '일일업무 쓰러 가기', href: '/daily' }}
        />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {items.map((it) => {
            const st = STATUS_STYLE[it.status]
            return (
              <li className="work-activity-card" key={it.id} style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius)', border: 'var(--hairline) solid var(--border-color)', background: 'var(--color-surface)', borderLeft: `3px solid ${MODULE_DOT[it.module]}` }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-muted)', background: 'var(--surface-bg)', border: 'var(--hairline) solid var(--border-color)', borderRadius: 'var(--radius)', padding: '1px 7px' }}>{MODULE_LABEL[it.module]}</span>
                    <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text)' }}>{ACTION_LABEL[it.action] ?? it.action}</span>
                    {it.status !== 'success' && (
                      <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: st.color, background: st.bg, border: `var(--hairline) solid ${st.border}`, borderRadius: '9999px', padding: '1px 8px' }}>{STATUS_LABEL[it.status]}</span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>{formatKstDateTimeShort(it.occurredAt)}</span>
                  </div>
                  {it.title && (
                    <p style={{ margin: '3px 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</p>
                  )}
                  {it.error?.message && (
                    <p style={{ margin: '3px 0 0', fontSize: 'var(--fs-xs)', color: 'var(--danger)' }}>
                      <AlertTriangle size={12} aria-hidden style={{ verticalAlign: 'text-bottom' }} /> {it.error.message}
                    </p>
                  )}
                  <ChangeList action={it.action} module={it.module} before={it.before} after={it.after} />
                  {it.restore && (
                    <button type="button" onClick={() => handleRestore(it.id, it.restore!)} disabled={restoring === it.id}
                      title="이 시점 상태로 되살립니다"
                      style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 'var(--radius)', background: 'var(--surface-bg)', color: 'var(--brand)', border: 'var(--hairline) solid var(--brand)', cursor: restoring === it.id ? 'wait' : 'pointer', fontSize: 'var(--fs-2xs)', fontWeight: 700 }}>
                      <Undo2 size={12} /> {restoring === it.id ? '되살리는 중…' : '되살리기'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!error && <ListPager query={query} hasMore={hasMore} onChange={set} loading={isValidating && !isLoading} />}
    </WorkPageShell>
  )
}

// 변경내용을 자연어 필드단위로 표시 — raw JSON 덤프 대체.
// 수정: `레이블 · 이전값 → 새값`(바뀐 필드만). 생성/삭제: `레이블 · 값`.
// 주간보고는 rows_json 배열 diff(카테고리행 단위), 그 외는 단일행 필드 diff.
function ChangeList({ action, module, before, after }: { action: string; module: FeedModule; before: ActivityFeedItem['before']; after: ActivityFeedItem['after'] }) {
  if (!before && !after) return null
  const changes = module === 'weekly'
    ? diffWeeklyRows((before?.rows as WeeklyRow[]) ?? null, (after?.rows as WeeklyRow[]) ?? null)
    : diffSnapshots(action, before, after)
  if (changes.length === 0) return null
  const isUpdate = action === 'update' || action === 'edit'
  const isDelete = action === 'delete'

  return (
    <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {changes.map((c) => (
        <li className="work-activity-change" key={c.field} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', fontSize: 'var(--fs-xs)', lineHeight: 1.5 }}>
          <span style={{ flexShrink: 0, fontWeight: 700, color: 'var(--text-muted)', minWidth: 56 }}>{c.label}</span>
          {isUpdate ? (
            <span style={{ minWidth: 0, color: 'var(--text)' }}>
              <span style={{ color: 'var(--text-faint)', textDecoration: 'line-through' }}>{c.from ?? '없음'}</span>
              <span style={{ margin: '0 6px', color: 'var(--brand)', fontWeight: 700 }}>→</span>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{c.to ?? '없음'}</span>
            </span>
          ) : (
            <span style={{ minWidth: 0, color: isDelete ? 'var(--text-faint)' : 'var(--text)', textDecoration: isDelete ? 'line-through' : 'none' }}>
              {(isDelete ? c.from : c.to) ?? '없음'}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
