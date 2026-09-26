// app/(trading)/trading/RecentRuns.tsx — 최근 실행
//
// 화면 파일 안에 인라인으로 있던 절을 부품으로 뗐다. 붙어 있을 때는 화면을 나눌 때마다
// 이 줄들이 따라다녀야 했고, 그래서 화면이 길어지는 만큼 고치기도 어려워졌다.

import { formatKstDateTimeExact } from '@/lib/datetime/kst'

export interface RecentRun {
  scheduledMinute: string
  status: string
  reason?: string | null
}

export default function RecentRuns({ rows }: { rows: readonly RecentRun[] }) {
  // 한 번도 안 돌았으면 빈 절을 그리지 않는다 — 제목만 있는 칸은 고장처럼 보인다
  if (rows.length === 0) return null
  return (
    <section className="card">
      <h2
        style={{
          fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)',
          margin: 0, marginBottom: 'var(--space-3)',
        }}
      >
        최근 실행
      </h2>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--space-2)' }}>
        {rows.map((run) => (
          <li key={run.scheduledMinute} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--text)' }}>{formatKstDateTimeExact(run.scheduledMinute)}</span>
            {' · '}
            {run.status}
            {run.reason ? ` · ${run.reason}` : ''}
          </li>
        ))}
      </ul>
    </section>
  )
}
