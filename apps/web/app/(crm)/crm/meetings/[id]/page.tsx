import MeetingDetail from './MeetingDetail'

export const metadata = { title: '미팅 상세 · 영업 CRM' }

export default async function CrmMeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <MeetingDetail meetingId={id} />
}
