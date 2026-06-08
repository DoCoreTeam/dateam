import { redirect } from 'next/navigation'

// 업무 허브 진입점 — 단일 "업무" 메뉴는 /work로 들어와 기본 탭(일일업무)으로 이동.
// 일일/부서/주간은 각 라우트 + 공유 WorkTabBar로 탭 전환(최소변경 IA).
export default function WorkPage() {
  redirect('/daily')
}
