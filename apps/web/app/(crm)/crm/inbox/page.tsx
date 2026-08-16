import { Inbox } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

export const metadata = { title: '인박스 · 영업 CRM' }

export default function CrmInboxPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="인박스"
        icon={<Inbox size={20} />}
        description="AI가 찾아낸 제안을 확인하고 반영하는 곳입니다."
      />
      <EmptyState
        title="확인할 제안이 아직 없어요"
        description="미팅을 기록하거나 텍스트를 붙여 넣으면 AI가 회사·인물·딜 후보를 여기로 올립니다."
        icon={<Inbox size={28} />}
        action={{ label: '딜 보러 가기', href: '/crm/deals' }}
      />
    </>
  )
}
