import { redirect } from 'next/navigation'

// 통합 입력은 GPU 관리 화면의 'intake' 탭과 단일 뷰로 통일됨.
// 독립 페이지·북마크·딥링크 모두 탭 뷰로 수렴(두 갈래 제거).
export default function IntakePage() {
  redirect('/pricing/gpu?tab=intake')
}
