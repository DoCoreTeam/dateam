import { Inbox } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import InboxClient from './InboxClient'

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
      <InboxClient />
    </>
  )
}
