import { Mic } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import MeetingsClient from './MeetingsClient'

export const metadata = { title: '미팅 · 영업 CRM' }

export default function CrmMeetingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title="미팅"
        icon={<Mic size={20} />}
        description="회의 내용을 넣으면 AI가 누가 나왔고 무엇이 걸림돌인지 뽑아 인박스로 보냅니다."
      />
      <MeetingsClient />
    </>
  )
}
