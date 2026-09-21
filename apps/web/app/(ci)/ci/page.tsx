// app/(ci)/ci/page.tsx — H01 홈 (설계서 §7.1)
// 오늘 할 일과 루프 현황. AI 입력창 → 루프 미니맵 → 오늘의 브리핑 → 자동 업데이트 상태.

import { redirect } from 'next/navigation'
import { createClient, getRequestUser } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { getHomeData } from '@/lib/ci/queries/home-data'
import HomeView from './HomeView'
import AccessDenied from '@/components/ui/AccessDenied'
import { SERVICE_LABEL } from '@/lib/terms'

export const dynamic = 'force-dynamic'

export default async function CiHomePage() {
  const supabase = await createClient()
  const user = await getRequestUser()
  if (!user) redirect('/login')

  /**
   * 워크스페이스가 없을 때 **자기 자신으로 보내지 않는다.**
   *
   * 예전 줄은 `redirect('/ci')` 였다. 여기가 바로 `/ci` 다.
   * 지금은 셸((ci)/layout.tsx)이 워크스페이스 없음을 먼저 잡아 만들기 화면을 그리므로
   * 이 가지까지 오지 않는다. 즉 **지금 도는 루프는 없다.**
   * 그래도 고친다 — 셸의 그 분기가 한 줄 바뀌는 순간 이 줄이 무한 루프가 되고,
   * 그때는 화면이 아무것도 안 그리므로 원인을 화면에서 찾을 수 없다.
   */
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) {
    return (
      <AccessDenied
        what={SERVICE_LABEL.ci}
        why="아직 참여한 워크스페이스가 없습니다. 관리자가 워크스페이스에 추가해 주면 바로 보입니다."
      />
    )
  }

  const data = await getHomeData(workspace.id)

  return <HomeView data={data} />
}
