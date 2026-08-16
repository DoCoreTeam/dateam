import { Workflow } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

export const metadata = { title: '프로세스 · 영업 CRM' }

export default function CrmProcessPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="프로세스"
        icon={<Workflow size={20} />}
        description="파이프라인 단계와 자동화를 그림으로 설계합니다."
      />
      <EmptyState
        title="아직 편집할 프로세스가 없어요"
        description="설정에서 파이프라인을 고르면 단계와 진입 조건을 여기서 손볼 수 있습니다."
        icon={<Workflow size={28} />}
        action={{ label: '설정 열기', href: '/crm/settings' }}
      />
    </>
  )
}
