'use client'

import { useState } from 'react'

interface MemberReport {
  userId: string
  userName: string
  category: string
  performance: string
  plan: string
  issues: string
  weekStart: string
}

interface TeamReportViewProps {
  weekOptions: string[]
  thisWeek: string
  initialReports: MemberReport[]
}

const CELL_BORDER = '1px solid #e2e8f0'

export default function TeamReportView({ weekOptions, thisWeek, initialReports }: TeamReportViewProps) {
  const [selectedWeek, setSelectedWeek] = useState(thisWeek)
  const [reports, setReports] = useState<MemberReport[]>(initialReports)
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState<MemberReport | null>(null)

  async function fetchWeek(week: string) {
    setLoading(true)
    try {
      const res = await fetch(`/api/weekly-report/team?week=${week}`)
      if (res.ok) {
        const data = await res.json() as MemberReport[]
        setReports(data)
      }
    } finally {
      setLoading(false)
    }
  }

  function handleWeekChange(week: string) {
    setSelectedWeek(week)
    fetchWeek(week)
  }

  // 이름별 그룹화
  const grouped = reports.reduce<Record<string, MemberReport[]>>((acc, r) => {
    if (!acc[r.userName]) acc[r.userName] = []
    acc[r.userName].push(r)
    return acc
  }, {})

  const members = Object.keys(grouped)

  return (
    <div>
      {/* 주차 선택 */}
      <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>주차</label>
        <select
          className="input-field"
          style={{ cursor: 'pointer', maxWidth: '280px' }}
          value={selectedWeek}
          onChange={(e) => handleWeekChange(e.target.value)}
        >
          {weekOptions.map((w) => (
            <option key={w} value={w}>
              {new Date(w).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })} 주
              {w === thisWeek ? ' (이번 주)' : ''}
            </option>
          ))}
        </select>
        {loading && <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>불러오는 중...</span>}
      </div>

      {/* 팀 보고 테이블 */}
      {members.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#94a3b8', fontSize: '0.875rem' }}>
          해당 주차 작성된 보고가 없습니다
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc' }}>
                <th style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#475569', border: CELL_BORDER, width: '90px' }}>이름</th>
                <th style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#475569', border: CELL_BORDER, width: '90px' }}>구분</th>
                <th style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#475569', border: CELL_BORDER }}>성과</th>
                <th style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#475569', border: CELL_BORDER }}>계획</th>
                <th style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#475569', border: CELL_BORDER, width: '18%' }}>이슈/협조사항</th>
              </tr>
            </thead>
            <tbody>
              {members.map((name) =>
                grouped[name].map((r, rIdx) => (
                  <tr
                    key={`${r.userId}-${r.category}-${rIdx}`}
                    style={{ cursor: 'pointer', backgroundColor: rIdx % 2 === 0 ? '#fff' : '#fafafa' }}
                    onClick={() => setModal(r)}
                  >
                    {rIdx === 0 && (
                      <td
                        rowSpan={grouped[name].length}
                        style={{ padding: '0.75rem', border: CELL_BORDER, fontWeight: 600, color: '#334155', verticalAlign: 'middle', whiteSpace: 'nowrap', backgroundColor: '#f8fafc' }}
                      >
                        {name}
                      </td>
                    )}
                    <td style={{ padding: '0.625rem 0.75rem', border: CELL_BORDER, verticalAlign: 'top', color: '#475569', whiteSpace: 'nowrap' }}>{r.category}</td>
                    <td style={{ padding: '0.625rem 0.75rem', border: CELL_BORDER, verticalAlign: 'top', maxWidth: '260px' }}>
                      {r.performance && r.performance !== '<p></p>' ? (
                        <div className="report-rich" style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', lineHeight: 1.55 }} dangerouslySetInnerHTML={{ __html: r.performance }} />
                      ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', border: CELL_BORDER, verticalAlign: 'top', maxWidth: '260px' }}>
                      {r.plan && r.plan !== '<p></p>' ? (
                        <div className="report-rich" style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', lineHeight: 1.55 }} dangerouslySetInnerHTML={{ __html: r.plan }} />
                      ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', border: CELL_BORDER, verticalAlign: 'top' }}>
                      {r.issues && r.issues !== '<p></p>' ? (
                        <div className="report-rich" style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.55 }} dangerouslySetInnerHTML={{ __html: r.issues }} />
                      ) : <span style={{ color: '#cbd5e1' }}>—</span>}
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
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ backgroundColor: '#fff', borderRadius: '1rem', padding: '1.5rem', maxWidth: '600px', width: '100%', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#6366f1', fontWeight: 700 }}>{modal.userName}</span>
                <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: '#0f172a', margin: '0.25rem 0 0' }}>{modal.category}</h3>
              </div>
              <button onClick={() => setModal(null)} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.25rem', lineHeight: 1 }}>×</button>
            </div>

            {[
              { label: '성과', value: modal.performance },
              { label: '계획', value: modal.plan },
              { label: '이슈/협조사항', value: modal.issues },
            ].map(({ label, value }) => value && value !== '<p></p>' ? (
              <div key={label} style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.375rem' }}>{label}</p>
                <div className="report-rich" style={{ fontSize: '0.875rem', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: value }} />
              </div>
            ) : null)}
          </div>
        </div>
      )}
    </div>
  )
}
