'use client'

// client 컴포넌트 — aggBadge가 client 모듈(DeptReportPanel)의 함수라, 서버 컴포넌트에서 호출 시
// client-reference 프록시가 되어 "not a function" 런타임 에러가 남. 같은 client 경계에서 호출해야 안전.
// props(stats·weekStart)는 서버 페이지가 넘기는 직렬화 가능한 값이라 client 경계 이동 안전.
import Link from 'next/link'
import { aggBadge } from '@/app/(member)/weekly-report/DeptReportPanel'
import type { DeptAggStat } from '@/lib/weekly-report/dept-agg-stats'

interface Props {
  stats: DeptAggStat[]
  weekStart: string
}

/** 어드민 취합 첫화면 — 전 부서 취합 상태 카드(취합완료 뱃지 + 제출 N/M). 부서 선택 없이 현황 한눈에. */
export default function DeptAggGrid({ stats, weekStart }: Props) {
  const confirmedCount = stats.filter((d) => d.agg === 'confirmed').length
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <h2 className="tape-title" style={{ margin: 0 }}>부서 취합 현황</h2>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          취합 완료 <strong style={{ color: 'var(--success)' }}>{confirmedCount}</strong> / 전체 {stats.length}부서
        </span>
      </div>
      <div className="responsive-grid-cols-3" style={{ gap: 'var(--space-3)' }}>
        {stats.map((d) => (
          <Link
            key={d.id}
            href={`/admin/reports?sel=d:${d.id}&week=${weekStart}`}
            prefetch={false}
            className="card"
            style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', textDecoration: 'none', color: 'var(--text)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
              <span style={{ fontWeight: 700 }}>{d.name}</span>
              {aggBadge(d.agg)}
            </div>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
              제출 {d.reportedCount}/{d.memberCount}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
