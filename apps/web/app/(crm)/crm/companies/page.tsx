import { Building2 } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

export const metadata = { title: '회사 · 영업 CRM' }

export default function CrmCompaniesPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="회사"
        icon={<Building2 size={20} />}
        description="거래처와 잠재 고객을 한곳에서 봅니다."
      />
      <EmptyState
        title="등록된 회사가 아직 없어요"
        description="명함이나 메일 서명을 붙여 넣으면 회사·인물·딜을 한 번에 만들 수 있습니다."
        icon={<Building2 size={28} />}
        action={{ label: '딜 보러 가기', href: '/crm/deals' }}
      />
    </>
  )
}
