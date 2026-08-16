import { BarChart3 } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

export const metadata = { title: '리포트 · 영업 CRM' }

export default function CrmReportsPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="리포트"
        icon={<BarChart3 size={20} />}
        description="파이프라인 합계와 전환을 봅니다."
      />
      <EmptyState
        title="집계할 딜이 아직 없어요"
        description="딜이 쌓이면 단계별 금액과 전환율이 여기에 나타납니다."
        icon={<BarChart3 size={28} />}
        action={{ label: '딜 보러 가기', href: '/crm/deals' }}
      />
    </>
  )
}
