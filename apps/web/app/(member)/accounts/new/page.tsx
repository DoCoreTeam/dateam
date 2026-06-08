import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AccountForm from '../AccountForm'
import LeadIntakeForm from '../../lead-intake/LeadIntakeForm'

interface PageProps { searchParams: Promise<{ mode?: string }> }

export default async function NewAccountPage({ searchParams }: PageProps) {
  const { mode } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  if (mode === 'manual') {
    return (
      <div>
        <div style={{ marginBottom: '1.75rem' }}>
          <h1 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', margin: 0 }}>
            거래처 수동 입력
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.375rem', fontSize: '0.9rem' }}>AI가 처리하지 못한 예외 건만 직접 등록합니다</p>
        </div>
        <AccountForm />
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', margin: 0 }}>
          AI로 거래처 추가
        </h1>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.375rem', fontSize: '0.9rem' }}>미팅 메모, 명함, 음성, 파일에서 거래처·담당자·영업기회를 자동 생성합니다</p>
      </div>
      <div className="card" style={{ padding: 'var(--space-6)', maxWidth: '760px' }}>
        <LeadIntakeForm />
      </div>
      <div style={{ marginTop: '1rem' }}>
        <Link href="/accounts/new?mode=manual" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-base)', fontWeight: 600, textDecoration: 'none' }}>
          수동 입력으로 전환
        </Link>
      </div>
    </div>
  )
}
