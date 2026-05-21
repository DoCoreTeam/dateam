import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getWeekStart, toDateString } from '@/lib/utils'
import { subWeeks } from 'date-fns'
import { FileText, Download } from 'lucide-react'
import type { Profile, WeeklyReport } from '@/types/database'
import AdminReportsPreview from './AdminReportsPreview'

function RichCell({ html }: { html: string }) {
  if (!html) return <span style={{ color: '#cbd5e1', fontSize: '0.8125rem' }}>-</span>
  if (html.startsWith('<')) {
    return <div className="report-rich" dangerouslySetInnerHTML={{ __html: html }} />
  }
  return (
    <p style={{ margin: 0, fontSize: '0.8125rem', color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
      {html}
    </p>
  )
}

interface PageProps {
  searchParams: Promise<{ week?: string; member?: string }>
}

export default async function AdminReportsPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { week, member } = await searchParams

  // 최근 8주 선택지
  const weekOptions = Array.from({ length: 8 }, (_, i) => {
    const d = getWeekStart(subWeeks(new Date(), i))
    return toDateString(d)
  })

  const selectedWeek = week ?? weekOptions[0]

  const adminClient = createAdminClient()

  // 전체 팀원 목록 (RLS 우회 — 어드민 전용 페이지)
  const { data: profiles } = await adminClient
    .from('profiles')
    .select('id, name')
    .is('deleted_at', null)
    .order('name') as unknown as { data: Pick<Profile, 'id' | 'name'>[] | null; error: unknown }

  // 선택한 주의 주간보고 (RLS 우회 — 어드민 전용 페이지)
  type ReportWithProfile = WeeklyReport & { profiles: { name: string } }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (adminClient as any)
    .from('weekly_reports')
    .select('*, profiles(name)')
    .eq('week_start', selectedWeek)
    .is('deleted_at', null)
    .order('category')

  if (member) {
    query = query.eq('user_id', member)
  }

  const { data: reports } = await query as { data: ReportWithProfile[] | null; error: unknown }

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 700,
            color: '#0f172a',
            letterSpacing: '-0.03em',
            margin: 0,
          }}
        >
          주간보고 취합
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          팀 전체 주간보고를 주차별로 확인합니다
        </p>
      </div>

      {/* 필터 */}
      <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
        <form style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
          <div>
            <label htmlFor="week" className="label">주차</label>
            <select
              id="week"
              name="week"
              defaultValue={selectedWeek}
              className="input-field"
              style={{ width: '220px', cursor: 'pointer' }}
            >
              {weekOptions.map((w) => (
                <option key={w} value={w}>
                  {new Date(w).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })} 주
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="member" className="label">팀원 필터</label>
            <select
              id="member"
              name="member"
              defaultValue={member ?? ''}
              className="input-field"
              style={{ width: '160px', cursor: 'pointer' }}
            >
              <option value="">전체 팀원</option>
              {(profiles ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn-primary">조회</button>
          <a
            href={`/api/reports/export?week=${selectedWeek}${member ? `&member=${member}` : ''}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
              padding: '0.5rem 1rem',
              backgroundColor: '#16a34a',
              color: '#fff',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            <Download size={14} />
            DOCX 다운로드
          </a>
        </form>
      </div>

      {/* AI 정제 미리보기 */}
      <div style={{ marginBottom: '1.5rem' }}>
        <AdminReportsPreview week={selectedWeek} member={member ?? ''} />
      </div>

      {/* 보고서 테이블 */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <FileText size={16} color="#6366f1" />
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
            {new Date(selectedWeek).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 주 보고서
          </h2>
          <span className="badge badge-slate">{reports?.length ?? 0}건</span>
        </div>

        {reports && reports.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="table-base" style={{ minWidth: '800px' }}>
              <thead>
                <tr>
                  <th style={{ width: '100px' }}>팀원</th>
                  <th style={{ width: '80px' }}>구분</th>
                  <th>성과</th>
                  <th>계획</th>
                  <th>이슈/협조사항</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => {
                  return (
                    <tr key={report.id}>
                      <td>
                        <span style={{ fontWeight: 500, color: '#374151' }}>
                          {report.profiles?.name ?? '-'}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-indigo">{report.category}</span>
                      </td>
                      <td style={{ maxWidth: '280px' }}>
                        <RichCell html={report.performance} />
                      </td>
                      <td style={{ maxWidth: '220px' }}>
                        <RichCell html={report.plan} />
                      </td>
                      <td style={{ maxWidth: '200px' }}>
                        <RichCell html={report.issues} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#94a3b8', fontSize: '0.875rem' }}>
            <FileText size={36} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
            <p style={{ margin: 0 }}>해당 주차에 작성된 주간보고가 없습니다</p>
          </div>
        )}
      </div>
    </div>
  )
}
