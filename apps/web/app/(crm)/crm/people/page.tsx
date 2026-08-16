import { Users } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

export const metadata = { title: '인물 · 영업 CRM' }

export default function CrmPeoplePage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="인물"
        icon={<Users size={20} />}
        description="담당자와 의사결정자를 관리합니다."
      />
      <EmptyState
        title="등록된 인물이 아직 없어요"
        description="회사를 먼저 만들면 그 회사의 담당자를 이어서 등록할 수 있습니다."
        icon={<Users size={28} />}
        action={{ label: '회사 보러 가기', href: '/crm/companies' }}
      />
    </>
  )
}
