import { Suspense } from 'react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import MeetingCapture from './MeetingCapture'

export const metadata = { title: '미팅 기록 · 영업 CRM' }

// useSearchParams 를 쓰는 클라이언트 컴포넌트라 Suspense 경계가 필요하다(Next App Router).
export default function CrmMeetingNewPage() {
  return (
    <Suspense fallback={<AXDotLoader />}>
      <MeetingCapture />
    </Suspense>
  )
}
