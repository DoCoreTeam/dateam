import { redirect } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import SegmentedTabs, { type SegmentedTab } from '@/components/ui/SegmentedTabs'
import { createClient } from '@/lib/supabase/server'
import AccountForm from '../AccountForm'
import LeadIntakeForm from '../../lead-intake/LeadIntakeForm'

interface PageProps { searchParams: Promise<{ mode?: string }> }

// AI ↔ 수동은 같은 화면의 두 입력 방식이다 — 링크 문구가 아니라 탭으로 고른다(§2 탭 SSOT).
// 경로가 같고 쿼리로만 갈리므로 activeId로 활성 탭을 알려준다.
const TABS: SegmentedTab[] = [
  { id: 'ai', label: 'AI 입력', href: '/accounts/new' },
  { id: 'manual', label: '수동 입력', href: '/accounts/new?mode=manual' },
]

export default async function NewAccountPage({ searchParams }: PageProps) {
  const { mode } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const isManual = mode === 'manual'

  return (
    <div>
      <PageHeader
        title="거래처 추가"
        description={isManual
          ? 'AI가 처리하지 못한 예외 건만 직접 등록합니다'
          : '미팅 메모, 명함, 음성, 파일에서 거래처·담당자·영업기회를 자동 생성합니다'}
        below={<SegmentedTabs tabs={TABS} ariaLabel="거래처 입력 방식" activeId={isManual ? 'manual' : 'ai'} />}
      />

      {isManual ? (
        <AccountForm />
      ) : (
        <div className="card" style={{ padding: 'var(--space-6)', maxWidth: '760px' }}>
          <LeadIntakeForm />
        </div>
      )}
    </div>
  )
}
