import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import { Inbox } from 'lucide-react'
import type { LeadIntake } from '@/types/database'
import LeadIntakeForm from './LeadIntakeForm'
import PageHeader from '@/components/ui/PageHeader'
import ProjectTabs from '@/components/ui/ProjectTabs'
import IntakeHistory from './IntakeHistory'
import { getBranding } from '@/lib/branding'

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
  const user = await getRequestUser()
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
    <div className="page-inner">
      <PageHeader title={`${targetLabel(target)} 인테이크`} description="텍스트, 명함, 음성, 파일을 입력하면 AI가 거래처·담당자·영업기회를 분석하고 생성 후보를 만듭니다" 
        below={<ProjectTabs />}
      />

      {/* 인테이크 폼 */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: 'var(--border-w-2) solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Inbox size={16} color="var(--brand)" />
          <h2 className="tape-title" style={{ margin: 0 }}>새 리드 입력</h2>
        </div>
        <div style={{ padding: 'var(--space-6)' }}>
          <LeadIntakeForm brandName={brandName} />
        </div>
      </div>

      {/* 인테이크 히스토리 — 목록 표준(§2-6). 표현은 IntakeHistory가 맡는다 */}
      <div className="card">
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: 'var(--border-w-2) solid var(--border-color)' }}>
          <h2 className="tape-title" style={{ margin: 0 }}>최근 인테이크</h2>
        </div>
        <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
          <IntakeHistory intakes={list} />
        </div>
      </div>
    </div>
  )
}
