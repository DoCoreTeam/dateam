'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import WorkTabBar from '@/components/ui/WorkTabBar'
import PageHeader from '@/components/ui/PageHeader'

type Axis = 'account' | 'deal'
interface Group { id: string; name: string; count: number; statusCounts: Record<string, number>; recent: { id: string; content: string; entry_type: string }[] }
interface Resp { by: Axis; groups: Group[]; ungrouped: number }

const AXIS: { key: Axis; label: string }[] = [{ key: 'account', label: '고객별' }, { key: 'deal', label: '딜별' }]

export default function WorkOverviewPage() {
  const [axis, setAxis] = useState<Axis>('account')
  const { data, isLoading } = useSWR<Resp>(`/api/work/groups?by=${axis}`, fetcher)
  const groups = data?.groups ?? []
  const ungrouped = data?.ungrouped ?? 0

  return (
    <div className="page-inner">
      <WorkTabBar />
      <PageHeader title="업무 현황" description="내가 어느 고객·딜에 얼마나 관여하고 있는지 한눈에 봅니다" />

      <div style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
        {AXIS.map((a) => (
          <button key={a.key} onClick={() => setAxis(a.key)} data-testid={`axis-${a.key}`}
            style={{
              fontSize: 'var(--fs-sm)', padding: '6px 14px', borderRadius: 'var(--radius)', cursor: 'pointer',
              background: axis === a.key ? 'var(--brand)' : 'var(--surface-bg)',
              color: axis === a.key ? '#fff' : 'var(--text-muted)',
              border: `var(--border-w-2) solid ${axis === a.key ? 'var(--brand)' : 'var(--border-color)'}`,
            }}>{a.label}</button>
        ))}
      </div>

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
          아직 {axis === 'account' ? '고객' : '딜'}에 연결된 업무가 없습니다.
        </div>
      )}

      {!isLoading && ungrouped > 0 && (
        <div data-testid="ungrouped" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', borderRadius: 'var(--radius)', background: 'var(--surface-bg)', border: 'var(--hairline) dashed var(--border-color)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          🔗 아직 {axis === 'account' ? '고객' : '딜'}에 연결 안 된 업무 <b style={{ color: 'var(--text)' }}>{ungrouped}건</b> — 업무 플로우에서 AI가 연관을 제안합니다.
        </div>
      )}
    </div>
  )
}
