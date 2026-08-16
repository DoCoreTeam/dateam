import { Handshake } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

export const metadata = { title: '딜 · 영업 CRM' }

export default function CrmDealsPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="딜"
        icon={<Handshake size={20} />}
        description="진행 중인 영업 건을 파이프라인으로 봅니다."
      />
      <EmptyState
        title="진행 중인 딜이 아직 없어요"
        description="회사를 고르고 딜 이름만 정하면 시작됩니다. 금액은 나중에 채워도 됩니다."
        icon={<Handshake size={28} />}
        action={{ label: '회사 보러 가기', href: '/crm/companies' }}
      />
    </>
  )
}
