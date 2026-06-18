import PageHeader from '@/components/ui/PageHeader'
import MeetingEditor from '../MeetingEditor'

export const dynamic = 'force-dynamic'

export default function NewMeetingNotePage() {
  return (
    <div>
      <PageHeader title="새 회의노트" description="회의 내용을 기록하면 저장 후 AI 정제·업무 추출을 진행할 수 있습니다" />
      <MeetingEditor
        mode="create"
        initial={{ title: '', meeting_at: null, attendees: '', tags: [], body: '' }}
      />
    </div>
  )
}
