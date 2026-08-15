import { requireAdmin } from '@/lib/auth/requireAdmin'

export default async function ProjectLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  // 탭은 각 화면의 PageHeader(below)가 그린다 — 레이아웃에서 그리면 구조상 **제목보다 위**가 되어,
  // 지금 보고 있는 화면 이름을 알기 전에 다른 화면 목록부터 읽게 된다(업무·리서치와 순서가 반대였다).
  return (
    <>
      {children}
    </>
  )
}
