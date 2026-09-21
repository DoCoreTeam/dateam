import { canOpen } from '@/lib/access/guard'
import AccessDenied from '@/components/ui/AccessDenied'
import { navLabel } from '@/lib/nav/menu'

export default async function ProjectLayout({ children }: { children: React.ReactNode }) {
  /**
   * 열렸나를 **메뉴와 같은 함수**에게 묻는다(`lib/access/guard.ts`).
   *
   * 예전엔 여기가 `role !== 'admin'` 을 직접 봤다. 그래서 관리자가 이 화면을 한 부서에
   * 열어 줘도 **메뉴에만 뜨고 들어오면 막혔다** — 판정이 두 벌이면 반드시 갈린다.
   * 지금은 부여가 0건이면 표면 기본값(`admin`)이 남아 예전과 같은 답이 나온다.
   *
   * 막을 때는 **여기서 말한다.** 예전엔 `requireAdmin()` 이 /dashboard 로 보냈고
   * next.config 가 그것을 /home 으로 되돌려, 사용자는 눌렀는데 홈에 와 있었다 —
   * 아무 말도 없이(실측 2026-09-21). CRM 셸이 같은 사고를 먼저 겪고 고친 방식을 따른다.
   */
  if (!(await canOpen('/accounts'))) return <AccessDenied what={navLabel('/accounts')} />

  // 탭은 각 화면의 PageHeader(below)가 그린다 — 레이아웃에서 그리면 구조상 **제목보다 위**가 되어,
  // 지금 보고 있는 화면 이름을 알기 전에 다른 화면 목록부터 읽게 된다(업무·리서치와 순서가 반대였다).
  return (
    <>
      {children}
    </>
  )
}
