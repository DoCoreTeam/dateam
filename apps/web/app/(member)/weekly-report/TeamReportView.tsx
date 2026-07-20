'use client'
import { useEscClose } from '@/lib/use-esc-close'

import { useState } from 'react'
import RichText from '@/components/ui/RichText'

interface MemberReport {
  userId: string
  userName: string
  role?: string
  category: string
  performance: string
  plan: string
  issues: string
  weekStart: string
}

interface TeamReportViewProps {
  weekOptions: string[]
  thisWeek: string
  /** 서버가 선택 주차(?week=)로 확정해 준 초기 주차 — 탭 전환에도 유지되는 연속성 SSOT. */
  initialWeek: string
  initialReports: MemberReport[]
}

const CELL_BORDER = 'var(--border-w-2) solid var(--border-color)'

export default function TeamReportView({ initialReports }: TeamReportViewProps) {
  // 주차는 상단 공용 WeekPicker(?week=)가 서버 리렌더로 주입 → 뷰는 서버가 준 initialReports를 그대로 렌더.
  // (자체 주차 select·클라 fetch 제거 — 주차 선택기 중복 해소, SSOT)
  const reports = initialReports
  const [modal, setModal] = useState<MemberReport | null>(null)
  useEscClose(() => setModal(null), !!modal)

  // 이름별 그룹화
  const grouped = reports.reduce<Record<string, MemberReport[]>>((acc, r) => {
    if (!acc[r.userName]) acc[r.userName] = []
    acc[r.userName].push(r)
    return acc
  }, {})

  // 본부장(admin)을 항상 최상위로
  const memberRole = new Map<string, string>()
  reports.forEach((r) => { if (!memberRole.has(r.userName)) memberRole.set(r.userName, r.role ?? 'member') })
  const members = Object.keys(grouped).sort((a, b) =>
    (memberRole.get(a) === 'admin' ? 0 : 1) - (memberRole.get(b) === 'admin' ? 0 : 1)
  )

  return (
    <div>
      {/* 팀 보고 테이블 (주차 표시·변경은 상단 공용 WeekPicker) */}
      {members.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-12) var(--space-4)', color: 'var(--text-faint)', fontSize: 'var(--fs-base)' }}>
          해당 주차 작성된 보고가 없습니다
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table-base table-card" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg)' }}>
                <th style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', border: CELL_BORDER, width: '90px' }}>이름</th>
                <th style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', border: CELL_BORDER, width: '90px' }}>구분</th>
                <th style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', border: CELL_BORDER }}>성과</th>
                <th style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', border: CELL_BORDER }}>계획</th>
                <th style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', border: CELL_BORDER, width: '18%' }}>이슈/협조사항</th>
              </tr>
            </thead>
            <tbody>
              {members.map((name) =>
                grouped[name].map((r, rIdx) => (
                  <tr
                    key={`${r.userId}-${r.category}-${rIdx}`}
                    style={{ cursor: 'pointer', backgroundColor: rIdx % 2 === 0 ? '#fff' : 'var(--surface-bg)' }}
                    onClick={() => setModal(r)}
                  >
                    <td className="mobile-only card-header">
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{name}</span>
                    </td>
                    {rIdx === 0 && (
                      <td
                        rowSpan={grouped[name].length}
                        className="card-hide"
                        style={{ padding: 'var(--space-3)', border: CELL_BORDER, fontWeight: 600, color: 'var(--text)', verticalAlign: 'middle', whiteSpace: 'nowrap', backgroundColor: 'var(--color-bg)' }}
                      >
                        {name}
                      </td>
                    )}
                    <td data-label="구분" style={{ padding: '0.625rem 0.75rem', border: CELL_BORDER, verticalAlign: 'top', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{r.category}</td>
                    <td data-label="성과" style={{ padding: '0.625rem 0.75rem', border: CELL_BORDER, verticalAlign: 'top', maxWidth: '260px' }}>
                      {r.performance && r.performance !== '<p></p>' ? (
                        <RichText html={r.performance} style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', lineHeight: 1.55 }} />
                      ) : <span style={{ color: 'var(--border-subtle)' }}>—</span>}
                    </td>
                    <td data-label="계획" style={{ padding: '0.625rem 0.75rem', border: CELL_BORDER, verticalAlign: 'top', maxWidth: '260px' }}>
                      {r.plan && r.plan !== '<p></p>' ? (
                        <RichText html={r.plan} style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', lineHeight: 1.55 }} />
                      ) : <span style={{ color: 'var(--border-subtle)' }}>—</span>}
                    </td>
                    <td data-label="이슈" style={{ padding: '0.625rem 0.75rem', border: CELL_BORDER, verticalAlign: 'top' }}>
                      {r.issues && r.issues !== '<p></p>' ? (
                        <RichText html={r.issues} style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.55 }} />
                      ) : <span style={{ color: 'var(--border-subtle)' }}>—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 모달 */}
      {modal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="보고 상세"
          onClick={() => setModal(null)}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 'var(--space-4)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ backgroundColor: '#fff', borderRadius: 'var(--radius)', padding: 'var(--space-6)', maxWidth: '600px', width: '100%', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', fontWeight: 700 }}>{modal.userName}</span>
                <h3 className="tape-title" style={{ margin: 0 }}>{modal.category}</h3>
              </div>
              <button onClick={() => setModal(null)} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: '1.25rem', lineHeight: 1 }}>×</button>
            </div>

            {[
              { label: '성과', value: modal.performance },
              { label: '계획', value: modal.plan },
              { label: '이슈/협조사항', value: modal.issues },
            ].map(({ label, value }) => value && value !== '<p></p>' ? (
              <div key={label} style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.375rem' }}>{label}</p>
                <RichText html={value} style={{ fontSize: 'var(--fs-base)', lineHeight: 1.7 }} />
              </div>
            ) : null)}
          </div>
        </div>
      )}
    </div>
  )
}
