// 구 업무 현황 라우트 — v0.7.286에서 '프로젝트 현황' 탭으로 병합됨(E).
// 기존 링크·북마크 호환을 위해 /work/projects?view=overview로 영구 리다이렉트.
import { redirect } from 'next/navigation'

export default function WorkOverviewRedirect() {
  redirect('/work/projects?view=overview')
}
