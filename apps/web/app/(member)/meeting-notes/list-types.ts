// 회의노트 목록 뷰(리스트/날짜별/캘린더)가 공유하는 아이템 타입.
export interface MeetingListItemView {
  id: string
  title: string
  meeting_at: string | null
  status: string
  summary: string | null
  body_plain: string | null
  department_id: string | null
  tags: string[] | null
  attendees: string[] | null
  attendee_user_ids: string[] | null
}
