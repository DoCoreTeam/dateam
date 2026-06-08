import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Inbox } from 'lucide-react'
import type { LeadIntake } from '@/types/database'
import LeadIntakeForm from './LeadIntakeForm'
import IntakeActions from './IntakeActions'
import { getBranding } from '@/lib/branding'

function statusBadge(status: string) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    pending: { color: 'var(--warning)', bg: 'var(--warning-bg)', label: '대기' },
    processing: { color: 'var(--info)', bg: 'var(--info-bg)', label: '처리중' },
    completed: { color: 'var(--success)', bg: 'var(--success-bg)', label: '완료' },
    crm_registered: { color: 'var(--brand-dark)', bg: 'var(--brand-soft)', label: 'CRM 등록' },
    failed: { color: 'var(--danger)', bg: 'var(--danger-bg)', label: '실패' },
  }
  return map[status] ?? { color: 'var(--text-muted)', bg: 'var(--color-bg)', label: status }
}

function sourceLabel(source: string) {
  const map: Record<string, string> = {
    prompt: '텍스트', business_card: '명함', card_scan: '명함', file: '파일', manual: '직접입력', voice: '음성', xlsx_bulk: '대량파일',
  }
  return map[source] ?? source
}

interface PageProps { searchParams: Promise<{ target?: string }> }

function targetLabel(target?: string) {
  if (target === 'account') return '거래처'
  if (target === 'contact') return '담당자'
  if (target === 'deal') return '영업기회'
  return '리드'
}

export default async function LeadIntakePage({ searchParams }: PageProps) {
  const { target } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = adminClient as any

  const [intakesRes, branding] = await Promise.all([
    adm.from('lead_intakes').select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(20) as Promise<{ data: LeadIntake[] | null }>,
    getBranding(),  // 브랜드 SSOT — 사이드바와 동일 소스(옛 org_content META 대신)
  ])

  const list = intakesRes.data ?? []
  const brandName: string = branding.brandName

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', margin: 0 }}>
          {targetLabel(target)} 인테이크
        </h1>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          텍스트, 명함, 음성, 파일을 입력하면 AI가 거래처·담당자·영업기회를 분석하고 생성 후보를 만듭니다
        </p>
      </div>

      {/* 인테이크 폼 */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: 'var(--border-w-2) solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Inbox size={16} color="var(--brand)" />
          <h2 className="tape-title" style={{ margin: 0 }}>새 리드 입력</h2>
        </div>
        <div style={{ padding: '1.5rem' }}>
          <LeadIntakeForm brandName={brandName} />
        </div>
      </div>

      {/* 인테이크 히스토리 */}
      {list.length > 0 && (
        <div className="card">
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: 'var(--border-w-2) solid var(--border-color)' }}>
            <h2 className="tape-title" style={{ margin: 0 }}>최근 인테이크</h2>
          </div>
          <table className="table-base table-card">
            <thead>
              <tr>
                <th>내용</th>
                <th>출처</th>
                <th>상태</th>
                <th>Fit</th>
                <th>일시</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((intake) => {
                const sb = statusBadge(intake.status)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const parsed = intake.parsed_data as any
                const TITLE_MAX = 40
                const truncate = (s: string) => s.length > TITLE_MAX ? s.substring(0, TITLE_MAX) + '…' : s
                const companyName = parsed?.company_name ?? null
                const displayTitle = companyName ? truncate(companyName) : (intake.raw_input ? truncate(intake.raw_input) : '파일 업로드')
                const displaySub = companyName && intake.raw_input ? truncate(intake.raw_input) : null
                return (
                  <tr key={intake.id}>
                    <td className="card-header">
                      <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '0.5rem' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayTitle}</div>
                          {displaySub && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: '0.125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displaySub}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td data-label="출처">
                      <span className="badge badge-slate" style={{ fontSize: '0.75rem' }}>{sourceLabel(intake.source)}</span>
                    </td>
                    <td data-label="상태">
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '9999px', color: sb.color, background: sb.bg }}>{sb.label}</span>
                    </td>
                    <td data-label="Fit">
                      {intake.fit_score !== null ? (
                        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: intake.fit_score >= 70 ? 'var(--success)' : intake.fit_score >= 40 ? 'var(--warning)' : 'var(--danger)' }}>
                          {intake.fit_score}점
                        </span>
                      ) : <span style={{ color: 'var(--border-subtle)' }}>-</span>}
                    </td>
                    <td data-label="일시">
                      <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                        {new Date(intake.created_at).toLocaleDateString('ko-KR')}
                      </span>
                    </td>
                    <td data-label="관리" className="card-actions">
                      <IntakeActions intakeId={intake.id} notes={intake.notes} />
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
