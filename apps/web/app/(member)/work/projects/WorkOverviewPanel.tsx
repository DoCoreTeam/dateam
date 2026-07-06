// 업무 현황 패널 — 구 /work/overview 본문을 컴포넌트로 추출(E: 현황→프로젝트 현황 탭 병합).
// 프로젝트 현황 탭의 '현황' 뷰에서 렌더. 축 전환(고객/딜/프로젝트)은 패널 내부 상태.
'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import WorkSubTabs from '@/components/ui/WorkSubTabs'

type Axis = 'account' | 'deal' | 'project'
interface Group { id: string; name: string; count: number; statusCounts: Record<string, number>; recent: { id: string; content: string; entry_type: string }[] }
interface Resp { by: Axis; groups: Group[]; ungrouped: number }
interface Dash { total: number; distribution: { id: string; name: string; count: number }[]; trend: { weekStart: string; count: number }[]; rollup: Record<string, number> }

const AXIS: { key: Axis; label: string }[] = [{ key: 'account', label: '고객별' }, { key: 'deal', label: '딜별' }, { key: 'project', label: '프로젝트별' }]
const AXIS_NOUN: Record<Axis, string> = { account: '고객', deal: '딜', project: '프로젝트' }

export default function WorkOverviewPanel() {
  const [axis, setAxis] = useState<Axis>('account')
  const { data, isLoading } = useSWR<Resp>(`/api/work/groups?by=${axis}`, fetcher)
  const { data: dash } = useSWR<Dash>('/api/work/dashboard', fetcher)
  const groups = data?.groups ?? []
  const ungrouped = data?.ungrouped ?? 0

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <WorkSubTabs
          items={AXIS.map((a) => ({ key: a.key, label: a.label, testId: `axis-${a.key}` }))}
          activeKey={axis}
          onSelect={(k) => setAxis(k as Axis)}
          ariaLabel="현황 축 전환"
        />
      </div>

      {/* 워크로드 대시보드 — 관여분포·활동추세·상태 롤업(건수/비중) */}
      {dash && (
        <div data-testid="work-dashboard" className="responsive-grid-cols-3" style={{ display: 'grid', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
          <div style={{ border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-3)', background: 'var(--color-bg)' }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>관여 분포 (고객)</div>
            {dash.distribution.length === 0 ? <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>연결된 업무 없음</span> : dash.distribution.map((d) => {
              const max = Math.max(...dash.distribution.map((x) => x.count), 1)
              return (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 3 }}>
                  <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', minWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                  <div style={{ flex: 1, height: 10, background: 'var(--surface-bg)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                    <div style={{ width: `${(d.count / max) * 100}%`, height: '100%', background: 'var(--brand)' }} />
                  </div>
                  <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text)', minWidth: 18, textAlign: 'right' }}>{d.count}</span>
                </div>
              )
            })}
          </div>
          <div style={{ border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-3)', background: 'var(--color-bg)' }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>활동 추세 (최근 8주)</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 60 }}>
              {dash.trend.map((t) => {
                const max = Math.max(...dash.trend.map((x) => x.count), 1)
                return <div key={t.weekStart} title={`${t.weekStart}: ${t.count}`} style={{ flex: 1, height: `${Math.max((t.count / max) * 100, 4)}%`, background: 'var(--brand)', borderRadius: '2px 2px 0 0', opacity: t.count ? 1 : 0.25 }} />
              })}
            </div>
          </div>
          <div style={{ border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-3)', background: 'var(--color-bg)' }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>상태 ({dash.total}건)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              <div>완료 <b style={{ color: 'var(--text)' }}>{dash.rollup.done ?? 0}</b></div>
              <div>진행 <b style={{ color: 'var(--text)' }}>{dash.rollup.doing ?? 0}</b></div>
              <div>예정 <b style={{ color: 'var(--text)' }}>{dash.rollup.planned ?? 0}</b></div>
              <div>블로커 <b style={{ color: 'var(--danger)' }}>{dash.rollup.blocker ?? 0}</b></div>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div style={{ color: 'var(--text-faint)', padding: 'var(--space-6)', textAlign: 'center' }}>불러오는 중…</div>
      ) : (
        <div data-testid="work-groups" className="responsive-grid-cols-3" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          {groups.map((g) => (
            <div key={g.id} style={{ border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-3)', background: 'var(--color-bg)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                <span style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)', wordBreak: 'break-word' }}>{g.name}</span>
                <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, color: 'var(--brand)' }}>{g.count}</span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)', fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>
                {g.statusCounts.done > 0 && <span>완료 {g.statusCounts.done}</span>}
                {g.statusCounts.doing > 0 && <span>진행 {g.statusCounts.doing}</span>}
                {g.statusCounts.planned > 0 && <span>예정 {g.statusCounts.planned}</span>}
                {g.statusCounts.blocker > 0 && <span style={{ color: 'var(--danger)' }}>블로커 {g.statusCounts.blocker}</span>}
              </div>
              <ul style={{ listStyle: 'none', margin: 'var(--space-2) 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {g.recent.slice(0, 3).map((r) => (
                  <li key={r.id} style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>· {r.content}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {!isLoading && groups.length === 0 && (
        <div style={{ color: 'var(--text-faint)', padding: 'var(--space-6)', textAlign: 'center', fontSize: 'var(--fs-sm)' }}>
          아직 {AXIS_NOUN[axis]}에 연결된 업무가 없습니다.
        </div>
      )}

      {!isLoading && ungrouped > 0 && (
        <div data-testid="ungrouped" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', borderRadius: 'var(--radius)', background: 'var(--surface-bg)', border: 'var(--hairline) dashed var(--border-color)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          🔗 아직 {AXIS_NOUN[axis]}에 연결 안 된 업무 <b style={{ color: 'var(--text)' }}>{ungrouped}건</b> — 업무 플로우에서 AI가 연관을 제안합니다.
        </div>
      )}
    </div>
  )
}
