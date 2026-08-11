// app/(ci)/ci/page.tsx — H01 홈 (설계서 §7.1)
// 오늘 할 일과 루프 현황. AI 입력창 → 루프 미니맵 → 오늘의 브리핑 → 자동 업데이트 상태.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { getHomeData } from '@/lib/ci/queries/home-data'
import HomeView from './HomeView'

export const dynamic = 'force-dynamic'

export default async function CiHomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const data = await getHomeData(workspace.id)

  return <HomeView data={data} />
}
