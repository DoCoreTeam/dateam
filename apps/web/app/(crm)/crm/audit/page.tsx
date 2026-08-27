import { History } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import CrmGroupTabs from '@/components/crm/CrmGroupTabs'
import AuditClient from './AuditClient'

export const metadata = { title: '기록 · 영업 CRM' }

export default function CrmAuditPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="기록"
        icon={<History size={20} />}
        description="누가 언제 무엇을 바꿨는지 남습니다. AI가 채운 값도 여기서 확인할 수 있어요."
        below={<CrmGroupTabs />}
      />
      <AuditClient />
    </>
  )
}
