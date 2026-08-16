import { Mic } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

export const metadata = { title: '미팅 · 영업 CRM' }

export default function CrmMeetingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="미팅"
        icon={<Mic size={20} />}
        description="미팅 기록과 녹음을 남기고 AI 추출을 돌립니다."
      />
      <EmptyState
        title="기록된 미팅이 아직 없어요"
        description="미팅을 만들고 녹음을 올리면 전사·요약·제안까지 이어집니다."
        icon={<Mic size={28} />}
        action={{ label: '딜 보러 가기', href: '/crm/deals' }}
      />
    </>
  )
}
