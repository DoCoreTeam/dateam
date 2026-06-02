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

  // META에서 org명 읽기
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: metaRow } = await (adminClient as any)
    .from('org_content').select('value').eq('key', 'META').single()
  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const orgName = (meta.org as string | undefined) || (meta.title as string | undefined) || ''

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
          전체 조직 주간보고 취합
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          모든 조직(전 부서) 주간보고를 주차별로 AI 취합합니다 — 부서 단위 취합은 각 부서장이 사용자 화면(주간보고 → 조직 현황)에서 수행합니다
        </p>
      </div>

      {/* 필터 */}
      <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
        <form style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label htmlFor="week" className="label">주차</label>
            <select
              id="week"
              name="week"
              defaultValue={selectedWeek}
              className="input-field"
              style={{ width: 'clamp(160px, 100%, 220px)', cursor: 'pointer' }}
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
              style={{ width: 'clamp(120px, 100%, 160px)', cursor: 'pointer' }}
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

      {/* AI 주간보고 취합 */}
      <div style={{ marginBottom: '1.5rem' }}>
        <AdminReportsPreview week={selectedWeek} member={member ?? ''} orgName={orgName} />
      </div>

      {/* 보고서 테이블 */}
      <div className="card">
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
          <table className="table-base table-card">
            <thead>
              <tr>
                <th style={{ width: '120px', whiteSpace: 'nowrap' }}>팀원</th>
                <th style={{ width: '80px', whiteSpace: 'nowrap' }}>구분</th>
                <th>성과</th>
                <th>계획</th>
                <th>이슈/협조사항</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => {
                return (
                  <tr key={report.id}>
                    <td className="card-header">
                      <span style={{ fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap' }}>
                        {report.profiles?.name ?? '-'}
                      </span>
                    </td>
                    <td data-label="구분">
                      <span className="badge badge-indigo">{report.category}</span>
                    </td>
                    <td data-label="성과" style={{ maxWidth: '280px' }}>
                      <RichCell html={report.performance} />
                    </td>
                    <td data-label="계획" style={{ maxWidth: '220px' }}>
                      <RichCell html={report.plan} />
                    </td>
                    <td data-label="이슈" style={{ maxWidth: '200px' }}>
                      <RichCell html={report.issues} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
