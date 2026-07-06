// 업무 허브 통합 이력 탭 (프로젝트 현황 옆). 일일·주간·부서·프로젝트의 모든 활동을
// 한 피드로 최신순 표시 — 성공/실패/부분, 저장값 스냅샷, 실패 원인까지. 모듈·상태 필터 + 더보기.
'use client'

import { useState, useCallback } from 'react'
import useSWRInfinite from 'swr/infinite'
import { History, AlertTriangle } from 'lucide-react'
import WorkPageShell from '@/components/ui/WorkPageShell'
import WorkSubTabs from '@/components/ui/WorkSubTabs'
import { fetcher } from '@/lib/swr-config'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import {
  MODULE_LABEL, ACTION_LABEL, STATUS_LABEL,
  type ActivityFeedItem, type ActivityStatus, type FeedModule,
} from '@/lib/work/activity-log'

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

export default function WorkActivityPage() {
  const [mods, setMods] = useState<Set<FeedModule>>(new Set())
  const [status, setStatus] = useState<'all' | ActivityStatus>('all')

  const getKey = useCallback((index: number, prev: Page | null) => {
    if (prev && (!prev.hasMore || !prev.nextBefore)) return null
    const sp = new URLSearchParams()
    if (index > 0 && prev?.nextBefore) sp.set('before', prev.nextBefore)
    mods.forEach((m) => sp.append('module', m))
    if (status !== 'all') sp.set('status', status)
    return `/api/work/activity?${sp.toString()}`
  }, [mods, status])

  const { data, error, isLoading, size, setSize, isValidating } = useSWRInfinite<Page>(getKey, fetcher, { revalidateFirstPage: false })
  const items = data ? data.flatMap((p) => p.items) : []
  const hasMore = data ? Boolean(data[data.length - 1]?.hasMore) : false
  const loadingMore = isValidating && !isLoading && size > 1

  function toggleMod(m: FeedModule) {
    setMods((prev) => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m); else next.add(m)
      return next
    })
  }

  return (
    <WorkPageShell
      title="이력"
      description="일일·주간·부서·프로젝트의 모든 저장 활동을 한 곳에서 봅니다. 성공·실패 모두 기록됩니다."
      subTabs={
        <WorkSubTabs
          items={STATUS_TABS.map((s) => ({ key: s.key, label: s.label }))}
          activeKey={status}
          onSelect={(k) => setStatus(k as 'all' | ActivityStatus)}
          ariaLabel="상태 필터"
        />
      }
    >
      {/* 모듈 필터 칩 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {MODULES.map((m) => {
          const on = mods.has(m.key)
          return (
            <button key={m.key} onClick={() => toggleMod(m.key)}
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
        {mods.size > 0 && (
          <button onClick={() => setMods(new Set())} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer' }}>필터 해제</button>
        )}
      </div>

      {error ? (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-5)', borderRadius: 'var(--radius-lg)', border: 'var(--border-w-2) solid var(--danger-border)', background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>
          <AlertTriangle size={18} /> 이력을 불러오지 못했습니다
        </div>
      ) : isLoading ? (
        <div style={{ color: 'var(--text-faint)', padding: 'var(--space-6)', textAlign: 'center', fontSize: 'var(--fs-sm)' }}>불러오는 중…</div>
      ) : items.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-8) var(--space-4)', color: 'var(--text-faint)', textAlign: 'center' }}>
          <History size={32} strokeWidth={1.5} />
          <p style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text-muted)' }}>기록된 활동 이력이 없습니다</p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {items.map((it) => {
            const st = STATUS_STYLE[it.status]
            return (
              <li key={it.id} style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius)', border: 'var(--hairline) solid var(--border-color)', background: 'var(--color-surface)', borderLeft: `3px solid ${MODULE_DOT[it.module]}` }}>
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
                    <p style={{ margin: '3px 0 0', fontSize: 'var(--fs-xs)', color: 'var(--danger)' }}>⚠ {it.error.message}</p>
                  )}
                  {it.after && (
                    <details style={{ marginTop: 3 }}>
                      <summary style={{ fontSize: 'var(--fs-2xs)', color: 'var(--brand)', cursor: 'pointer' }}>저장된 값 보기</summary>
                      <pre style={{ margin: '4px 0 0', fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', background: 'var(--surface-bg)', borderRadius: 'var(--radius)', padding: 'var(--space-2)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(it.after, null, 2)}</pre>
                    </details>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {hasMore && !error && (
        <div style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
          <button onClick={() => setSize(size + 1)} disabled={loadingMore}
            style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-muted)', background: 'var(--surface-bg)', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-5)', cursor: loadingMore ? 'wait' : 'pointer' }}>
            {loadingMore ? '불러오는 중…' : '더 보기'}
          </button>
        </div>
      )}
    </WorkPageShell>
  )
}
