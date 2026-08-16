import { Inbox } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import InboxClient from './InboxClient'
import LeadImport from './LeadImport'

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
      {/* 옛 리드가 남아 있으면 인박스 맨 위에서 알린다 — 다 옮기면 스스로 사라진다 */}
      <LeadImport />
      <InboxClient />
    </>
  )
}
