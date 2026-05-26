import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Inbox } from 'lucide-react'
import type { LeadIntake } from '@/types/database'
import LeadIntakeForm from './LeadIntakeForm'

function statusBadge(status: string) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    pending: { color: '#d97706', bg: '#fffbeb', label: '대기' },
    processing: { color: '#0284c7', bg: '#f0f9ff', label: '처리중' },
    completed: { color: '#16a34a', bg: '#f0fdf4', label: '완료' },
    failed: { color: '#dc2626', bg: '#fef2f2', label: '실패' },
  }
  return map[status] ?? { color: '#64748b', bg: '#f8fafc', label: status }
}

function sourceLabel(source: string) {
  const map: Record<string, string> = {
    prompt: '텍스트', business_card: '명함', file: '파일', manual: '직접입력',
  }
  return map[source] ?? source
}

export default async function LeadIntakePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intakes } = await (adminClient as any)
    .from('lead_intakes')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20) as { data: LeadIntake[] | null }

  const list = intakes ?? []

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          리드 인테이크
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          텍스트나 파일로 리드를 입력하면 AI가 자동으로 거래처·담당자·영업기회를 분석합니다
        </p>
      </div>

      {/* 인테이크 폼 */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Inbox size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>새 리드 입력</h2>
        </div>
        <div style={{ padding: '1.5rem' }}>
          <LeadIntakeForm />
        </div>
      </div>

      {/* 인테이크 히스토리 */}
      {list.length > 0 && (
        <div className="card">
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
            <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>최근 인테이크</h2>
          </div>
          <table className="table-base table-card">
            <thead>
              <tr>
                <th>내용</th>
                <th>출처</th>
                <th>상태</th>
                <th>Fit</th>
                <th>일시</th>
              </tr>
            </thead>
            <tbody>
              {list.map((intake) => {
                const sb = statusBadge(intake.status)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const parsed = intake.parsed_data as any
                const companyName = parsed?.company_name ?? '-'
                return (
                  <tr key={intake.id}>
                    <td className="card-header">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '0.5rem' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.875rem' }}>{companyName}</div>
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.125rem' }}>
                            {intake.raw_input ? intake.raw_input.substring(0, 40) + '...' : '파일 업로드'}
                          </div>
                        </div>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '9999px', color: sb.color, background: sb.bg, flexShrink: 0 }}>{sb.label}</span>
                      </div>
                    </td>
                    <td data-label="출처">
                      <span className="badge badge-slate" style={{ fontSize: '0.75rem' }}>{sourceLabel(intake.source)}</span>
                    </td>
                    <td data-label="상태">
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: sb.color }}>{sb.label}</span>
                    </td>
                    <td data-label="Fit">
                      {intake.fit_score !== null ? (
                        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: intake.fit_score >= 70 ? '#16a34a' : intake.fit_score >= 40 ? '#d97706' : '#dc2626' }}>
                          {intake.fit_score}점
                        </span>
                      ) : <span style={{ color: '#cbd5e1' }}>-</span>}
                    </td>
                    <td data-label="일시">
                      <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>
                        {new Date(intake.created_at).toLocaleDateString('ko-KR')}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
