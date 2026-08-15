import { redirect } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import ProjectTabs from '@/components/ui/ProjectTabs'
import SegmentedTabs, { type SegmentedTab } from '@/components/ui/SegmentedTabs'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import DealForm from '../DealForm'
import type { Account, Contact } from '@/types/database'
import LeadIntakeForm from '../../lead-intake/LeadIntakeForm'

interface PageProps { searchParams: Promise<{ account_id?: string; mode?: string }> }

// 거래처·담당자 추가와 같은 골격 — AI ↔ 수동은 링크가 아니라 탭으로 고른다(§2-5 동종 UI 통일)
function tabsFor(accountId?: string): SegmentedTab[] {
  const q = accountId ? `account_id=${encodeURIComponent(accountId)}` : ''
  const join = (extra?: string) => {
    const parts = [q, extra].filter(Boolean)
    return parts.length ? `/deals/new?${parts.join('&')}` : '/deals/new'
  }
  return [
    { id: 'ai', label: 'AI 입력', href: join() },
    { id: 'manual', label: '수동 입력', href: join('mode=manual') },
  ]
}

export default async function NewDealPage({ searchParams }: PageProps) {
  const { account_id, mode } = await searchParams
  const supabase = await createClient()
  const user = await getRequestUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = adminClient as any
  const [{ data: accounts }, { data: contacts }] = await Promise.all([
    adm.from('accounts').select('id, name').order('name') as Promise<{ data: Pick<Account, 'id' | 'name'>[] | null }>,
    adm.from('contacts').select('id, name, account_id').order('name') as Promise<{ data: Pick<Contact, 'id' | 'name' | 'account_id'>[] | null }>,
  ])

  const isManual = mode === 'manual'

  return (
    <div>
      <PageHeader
        title="영업기회 추가"
        description={isManual
          ? '거래처·단계·금액을 직접 입력합니다'
          : '미팅 메모, 파일에서 영업기회 정보를 자동 생성합니다'}
        below={<>
          <ProjectTabs />
          <SegmentedTabs tabs={tabsFor(account_id)} ariaLabel="영업기회 입력 방식" activeId={isManual ? 'manual' : 'ai'} />
        </>}
      />

      {isManual ? (
        <DealForm accounts={accounts ?? []} contacts={contacts ?? []} defaultAccountId={account_id} />
      ) : (
        <div className="card" style={{ padding: 'var(--space-6)', maxWidth: '760px' }}>
          <LeadIntakeForm />
        </div>
      )}
    </div>
  )
}
