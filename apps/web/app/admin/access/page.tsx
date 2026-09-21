import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import { getRequestProfile } from '@/lib/auth/request-profile'
import { ACCESS, ACCESS_DEFAULT_NOTE } from '@/lib/terms'
import { loadAccessAdminData } from './actions'
import AccessClient from './AccessClient'

/**
 * 접근권한 화면 — **관리자만** (LOOP.md 7절 S2)
 *
 * 밑에서 도는 것은 `createAdminClient` 다. 서비스롤은 RLS 를 통째로 지나가고
 * `access_grant` 는 정책이 0개라, 사람 확인이 사라지면 그 순간 아무나 «누가 무엇을 볼 수 있는가»를
 * 읽게 된다. `app/admin/layout.tsx` 가 이미 한 번 막지만 **여기서 한 번 더 묻는다** —
 * 레이아웃은 다른 일로 고쳐질 수 있고, 그때 이 화면이 조용히 열리면 아무도 모른다.
 *
 * 부여는 매 요청 바뀔 수 있으므로 캐시하지 않는다. 열어 준 결과가 화면에 안 뜨면
 * 관리자는 «저장이 안 됐다»고 읽고 한 번 더 저장한다.
 */
export const dynamic = 'force-dynamic'

export default async function AccessPage() {
  const profile = await getRequestProfile()
  if (profile?.role !== 'admin') redirect('/home')

  const data = await loadAccessAdminData()

  return (
    <div>
      <PageHeader
        title={ACCESS.screen}
        icon={<ShieldCheck size={20} color="var(--brand)" />}
        description={ACCESS_DEFAULT_NOTE}
      />
      <AccessClient {...data} />
    </div>
  )
}
