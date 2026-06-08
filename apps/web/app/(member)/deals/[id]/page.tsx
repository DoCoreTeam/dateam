import { redirect, notFound } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { TrendingUp, ArrowLeft, Calendar, Target } from 'lucide-react'
import type { Deal, Account, Contact, DealActivity } from '@/types/database'
import ActivityLogger from './ActivityLogger'
import DealStageUpdater from './DealStageUpdater'

interface PageProps { params: Promise<{ id: string }> }

type DealFull = Deal & {
  accounts: Pick<Account, 'id' | 'name'> | null
  contacts: Pick<Contact, 'id' | 'name' | 'title'> | null
}

const STAGE_STYLE: Record<string, { color: string; bg: string }> = {
  '신규': { color: 'var(--text-muted)', bg: 'var(--color-bg)' },
  '검증': { color: 'var(--info)', bg: 'var(--info-bg)' },
  '컨택': { color: 'var(--brand)', bg: 'var(--brand-soft)' },
  'PoC': { color: 'var(--warning)', bg: 'var(--warning-bg)' },
  '제안': { color: 'var(--info)', bg: 'var(--info-bg)' },
  '협상': { color: 'var(--warning)', bg: 'var(--warning-bg)' },
  '수주': { color: 'var(--success)', bg: 'var(--success-bg)' },
  '실패': { color: 'var(--danger)', bg: 'var(--danger-bg)' },
}

const ACTIVITY_ICON: Record<string, string> = {
  call: '📞', email: '📧', meeting: '🤝', note: '📝', ai: '🤖',
}

export default async function DealDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = adminClient as any

  const [dealRes, activitiesRes] = await Promise.all([
    adm.from('deals').select('*, accounts(id, name), contacts(id, name, title)').eq('id', id).single() as Promise<{ data: DealFull | null }>,
    adm.from('deal_activities').select('*').eq('deal_id', id).order('created_at', { ascending: false }) as Promise<{ data: DealActivity[] | null }>,
  ])

  const deal = dealRes.data
  if (!deal) notFound()

  const activities = activitiesRes.data ?? []
  const sc = STAGE_STYLE[deal.stage] ?? STAGE_STYLE['신규']

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/deals" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', color: 'var(--brand)', fontSize: '0.875rem', fontWeight: 500, textDecoration: 'none', marginBottom: '0.75rem' }}>
          <ArrowLeft size={14} /> 영업기회 목록
        </Link>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
              <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>{deal.title}</h1>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '9999px', color: sc.color, background: sc.bg }}>{deal.stage}</span>
            </div>
            {deal.accounts?.name && (
              <Link href={`/accounts/${deal.accounts.id}`} style={{ fontSize: '0.875rem', color: 'var(--brand)', textDecoration: 'none' }}>
                {deal.accounts.name}
              </Link>
            )}
          </div>
          <Link href={`/deals/${id}/edit`} className="btn-primary" style={{ textDecoration: 'none', padding: '0.5rem 1rem', borderRadius: 'var(--radius)', fontSize: '0.875rem', minHeight: '44px', display: 'flex', alignItems: 'center' }}>
            편집
          </Link>
        </div>
      </div>

      <div className="responsive-grid-2" style={{ gap: '1.25rem', alignItems: 'flex-start' }}>
        {/* 좌측: 기본 정보 + 단계 업데이트 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
            <h2 className="tape-title" style={{ margin: 0 }}>기본 정보</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {deal.value && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <Target size={15} color="var(--brand)" />
                  <span style={{ fontSize: '0.875rem', color: 'var(--text)' }}>₩{deal.value.toLocaleString()}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>확률 {deal.probability}%</span>
                </div>
              )}
              {deal.close_date && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <Calendar size={15} color="var(--brand)" />
                  <span style={{ fontSize: '0.875rem', color: 'var(--text)' }}>마감: {deal.close_date}</span>
                </div>
              )}
              {deal.contacts && (
                <div style={{ fontSize: '0.875rem', color: 'var(--text)' }}>
                  담당자: <Link href={`/contacts/${deal.contacts.id}`} style={{ color: 'var(--brand)', textDecoration: 'none' }}>{deal.contacts.name}</Link>
                  {deal.contacts.title && <span style={{ color: 'var(--text-faint)' }}> ({deal.contacts.title})</span>}
                </div>
              )}
              {deal.description && (
                <p style={{ fontSize: '0.875rem', color: 'var(--text)', margin: '0.25rem 0 0', lineHeight: 1.6 }}>{deal.description}</p>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                {deal.lead_type && <span className="badge badge-slate">{deal.lead_type}</span>}
                {deal.product && <span className="badge badge-indigo">{deal.product}</span>}
                {deal.fit_score !== null && <span className="badge" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>Fit {deal.fit_score}</span>}
                {deal.expected_date && <span className="badge" style={{ background: 'var(--color-bg)', color: 'var(--text-muted)' }}>예상 {deal.expected_date}</span>}
                {deal.hw_included && <span className="badge" style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>HW</span>}
              </div>
            </div>
          </div>

          {/* 다음 액션 */}
          {(deal.next_action || deal.next_action_date) && (
            <div className="card" style={{ padding: '1.25rem 1.5rem', borderLeft: '3px solid var(--brand)' }}>
              <h2 className="tape-title" style={{ margin: 0 }}>다음 액션</h2>
              {deal.next_action && <p style={{ fontSize: '0.875rem', color: 'var(--text)', margin: 0 }}>{deal.next_action}</p>}
              {deal.next_action_date && <p style={{ fontSize: '0.8125rem', color: 'var(--text-faint)', margin: '0.25rem 0 0' }}>📅 {deal.next_action_date}</p>}
            </div>
          )}

          {/* 단계 변경 */}
          <DealStageUpdater dealId={id} currentStage={deal.stage} />
        </div>

        {/* 우측: 활동 로그 */}
        <div className="card">
          <div style={{ padding: '1rem 1.5rem', borderBottom: '2px solid var(--border-color)' }}>
            <h2 className="tape-title" style={{ margin: 0 }}>활동 로그</h2>
          </div>
          <ActivityLogger dealId={id} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {activities.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-faint)', fontSize: '0.875rem' }}>활동 기록이 없습니다</div>
            ) : activities.map((act) => (
              <div key={act.id} style={{ padding: '0.875rem 1.5rem', borderBottom: '1px solid var(--surface-muted)', display: 'flex', gap: '0.75rem' }}>
                <span style={{ fontSize: '1.125rem', flexShrink: 0 }}>{ACTIVITY_ICON[act.type] ?? '📝'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{act.content}</div>
                  {act.suggested_stage && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--brand)', marginTop: '0.25rem' }}>
                      단계 제안: {act.suggested_stage}
                    </div>
                  )}
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: '0.25rem' }}>
                    {new Date(act.created_at).toLocaleString('ko-KR')}
                    {act.ai_extracted && <span style={{ marginLeft: '0.375rem', color: 'var(--brand)' }}>· AI 추출</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
