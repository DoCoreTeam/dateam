import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getWeekStart, toDateString } from '@/lib/utils'
import { subWeeks } from 'date-fns'
import { FileText, Download } from 'lucide-react'
import type { Profile, WeeklyReport } from '@/types/database'
import AdminReportsPreview from './AdminReportsPreview'
import RichText from '@/components/ui/RichText'
import { resolveOrgScope, deptMemberUserIds } from '@/lib/org-scope'
import DeptReportPanel, { type AnyRow, type AggState } from '@/app/(member)/weekly-report/DeptReportPanel'

function RichCell({ html }: { html: string }) {
  return <RichText html={html} style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.6 }} />
}

interface PageProps {
  searchParams: Promise<{ week?: string; member?: string; sel?: string }>
}

export default async function AdminReportsPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { week, member: memberParam, sel } = await searchParams
  // sel 통합 파라미터: "" 전체 / "d:<deptId>" 부서 / "<userId>" 개인 (member 레거시 호환)
  const selValue = sel ?? (memberParam ? memberParam : '')
  const dept = selValue.startsWith('d:') ? selValue.slice(2) : undefined
  const member = !dept && selValue ? selValue : undefined

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

  // 부서 목록 (조직도)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: deptNodes } = await (adminClient as any)
    .from('org_nodes').select('id, name').eq('type', 'department').order('display_order') as { data: { id: string; name: string }[] | null }

  // 부서 선택 시 소속 멤버 user_id 집합 — 멤버 화면 취합과 동일하게 SSOT(deptMemberUserIds) 재사용.
  // (서브트리 내 person + 부서장 head_user_id 합집합 — 부서장 누락 방지, 두 취합 경로 결과 동일)
  let deptMemberIds: string[] | null = null
  if (dept) {
    const scope = await resolveOrgScope(adminClient, user.id)
    deptMemberIds = deptMemberUserIds(scope, dept)
  }
  const memberCsv = deptMemberIds ? deptMemberIds.join(',') : ''
  const deptName = dept ? ((deptNodes ?? []).find((d) => d.id === dept)?.name ?? '') : ''

  // 부서 선택 시: 멤버가 저장한 취합본(dept_weekly_reports) 로드 — 어드민도 멤버와 동일 SSOT 패널로 표시·재취합.
  let deptAgg: { body: AnyRow[]; status: AggState } | null = null
  if (dept) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: snap } = await (adminClient as any)
      .from('dept_weekly_reports').select('body, status')
      .eq('department_id', dept).eq('week_start', selectedWeek).maybeSingle() as { data: { body: AnyRow[]; status: 'draft' | 'confirmed' } | null }
    deptAgg = { body: (snap?.body as AnyRow[]) ?? [], status: (snap?.status as AggState) ?? 'none' }
  }

  // 선택한 주의 주간보고 (RLS 우회 — 어드민 전용 페이지)
  type ReportWithProfile = WeeklyReport & { profiles: { name: string } }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (adminClient as any)
    .from('weekly_reports')
    .select('*, profiles(name)')
    .eq('week_start', selectedWeek)
    .is('deleted_at', null)
    .order('category')

  if (dept) {
    query = query.in('user_id', deptMemberIds && deptMemberIds.length > 0 ? deptMemberIds : ['00000000-0000-0000-0000-000000000000'])
  } else if (member) {
    query = query.eq('user_id', member)
  }

  const { data: reports } = await query as { data: ReportWithProfile[] | null; error: unknown }

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1
          style={{
            fontSize: 'var(--fs-2xl)',
            fontWeight: 700,
            color: 'var(--text)',
            letterSpacing: '-0.03em',
            margin: 0,
          }}
        >
          전체 조직 주간보고 취합
        </h1>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          모든 조직(전 부서) 주간보고를 주차별로 AI 취합합니다 — 부서 단위 취합은 각 부서장이 사용자 화면(주간보고 → 조직 현황)에서 수행합니다
        </p>
      </div>

      {/* 필터 */}
      <div className="card" style={{ padding: 'var(--space-5) var(--space-6)', marginBottom: '1.5rem' }}>
        <form style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
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
            <label htmlFor="sel" className="label">부서 / 팀원 필터</label>
            <select
              id="sel"
              name="sel"
              defaultValue={selValue}
              className="input-field"
              style={{ width: 'clamp(160px, 100%, 200px)', cursor: 'pointer' }}
            >
              <option value="">전체 팀원</option>
              {(deptNodes ?? []).length > 0 && (
                <optgroup label="부서별">
                  {(deptNodes ?? []).map((d) => (
                    <option key={d.id} value={`d:${d.id}`}>{d.name}</option>
                  ))}
                </optgroup>
              )}
              <optgroup label="개인별">
                {(profiles ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            </select>
          </div>

          <button type="submit" className="btn-primary">조회</button>
          <a
            href={`/api/reports/export?week=${selectedWeek}${member ? `&member=${member}` : ''}${memberCsv ? `&members=${memberCsv}` : ''}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
              padding: 'var(--space-2) var(--space-4)',
              backgroundColor: 'var(--success)',
              color: '#fff',
              borderRadius: 'var(--radius)',
              fontSize: 'var(--fs-base)',
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

      {/* AI 주간보고 취합 (전체/개인 스코프) — 부서 선택 시엔 아래 보존형 부서 취합 패널(DeptReportPanel) 하나로 정리 */}
      {!dept && (
        <div style={{ marginBottom: '1.5rem' }}>
          <AdminReportsPreview week={selectedWeek} member={member ?? ''} members={memberCsv} deptName={deptName} orgName={orgName} />
        </div>
      )}

      {/* 부서 선택 시: 저장된 취합본 (멤버 화면과 동일 SSOT 패널) — 취합본 우선 표시 + 어드민 재취합 */}
      {dept && deptAgg && (
        <div style={{ marginBottom: '1.5rem' }}>
          <DeptReportPanel
            key={`${dept}-${selectedWeek}`}
            deptId={dept}
            deptName={deptName}
            weekStart={selectedWeek}
            editable
            agg={deptAgg.status}
            initialBody={deptAgg.body}
          />
        </div>
      )}

      {/* 원본 멤버 보고 — 부서 선택 시 접이식(취합본 아래 병행), 그 외 기본 펼침 */}
      {dept && (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '0 0 var(--space-2)' }}>
          아래는 취합 전 <strong>원본 멤버 보고</strong>입니다 (개별 작성분).
        </p>
      )}
      <details className="card" open={!dept} style={{ padding: 0 }}>
        <summary
          style={{
            padding: 'var(--space-5) var(--space-6)',
            borderBottom: 'var(--border-w-2) solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            cursor: 'pointer',
            listStyle: 'none',
          }}
        >
          <FileText size={16} color="var(--brand)" />
          <span className="tape-title" style={{ margin: 0 }}>
            {dept ? '원본 멤버 보고' : `${new Date(selectedWeek).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 주 보고서`}
          </span>
          <span className="badge badge-slate">{reports?.length ?? 0}건</span>
        </summary>

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
                      <span style={{ fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>
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
          <div style={{ textAlign: 'center', padding: 'var(--space-12) var(--space-4)', color: 'var(--text-faint)', fontSize: 'var(--fs-base)' }}>
            <FileText size={36} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
            <p style={{ margin: 0 }}>해당 주차에 작성된 주간보고가 없습니다</p>
          </div>
        )}
      </details>
    </div>
  )
}
