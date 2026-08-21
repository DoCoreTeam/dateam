/**
 * 제안 만료 잡 (dacrm 명세 3.3-1)
 *
 * **왜 이 파일이 뒤늦게 생겼나**: `expireSuggestions()` 는 완성돼 있고 테스트도 통과하는데
 * **부르는 곳이 테스트뿐이었다.** 즉 만료가 실제로는 한 번도 일어나지 않았다.
 *
 * 그러면 무슨 일이 생기나: 인박스에 몇 주 전 회의에서 나온 제안이 계속 남는다.
 * 어느 날 누가 그걸 수락하면, **그때 반영되는 값은 이미 지난 사실**이다.
 * 화면상으로는 아무 이상이 없어서 아무도 눈치채지 못한다 —
 * 이 저장소가 반복해 온 "만들어놓고 안 부르는" 사고의 또 다른 재현이다.
 *
 * 잡 입구 모양은 gmail-sync 와 같다. 새 방식을 만들지 않는다 —
 * 입구가 두 종류면 한쪽만 잠그게 된다.
 */
import type { NextRequest } from 'next/server'
import { expireSuggestions } from '@/lib/crm/services/suggestion'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveCrmAccess } from '@/lib/crm/auth/requireCrmMember'
import { isMachineCall, machineAuthUnconfigured } from '@/lib/crm/jobs/machine-auth'

export const maxDuration = 60

/** 한 판에 도는 워크스페이스 수 — 늘어나도 한 판이 60초를 안 넘게 */
const MAX_WORKSPACES = 50

/**
 * 워크스페이스 전부.
 *
 * 서비스롤로 읽는 이유: 크론에는 로그인 세션이 없다.
 * 경계는 `expireSuggestions` 가 각 워크스페이스 id 로 다시 건다.
 */
async function allWorkspaceIds(): Promise<string[]> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from('crm_workspace')
    .select('id')
    .limit(MAX_WORKSPACES)
  return ((data ?? []) as { id: string }[]).map((w) => w.id)
}

async function runFor(ids: string[]) {
  const results: Record<string, unknown>[] = []
  for (const id of ids) {
    try {
      results.push({ workspaceId: id, expired: await expireSuggestions(id) })
    } catch (e) {
      // 한 워크스페이스가 실패해도 나머지는 돌아야 한다
      console.error('[crm/expire-suggestions] 실패:', id, e)
      results.push({ workspaceId: id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return results
}

/** 크론·외부 스케줄러 전용 — 전 워크스페이스 */
export async function POST(req: NextRequest) {
  if (machineAuthUnconfigured()) {
    return Response.json({ error: { message: '워커 토큰이 설정되지 않았습니다' } }, { status: 500 })
  }
  if (!isMachineCall(req)) {
    return Response.json({ error: { message: '워커 토큰이 올바르지 않습니다' } }, { status: 401 })
  }

  const ids = await allWorkspaceIds()
  return Response.json({ workspaces: ids.length, results: await runFor(ids) })
}

/**
 * 사람이 인박스를 열었을 때 — 자기 워크스페이스만.
 *
 * 크론이 주 경로지만, 크론이 아직 안 붙은 환경에서도 인박스가
 * 지난 제안으로 차 있으면 안 된다. 화면이 열릴 때 자기 것만 정리한다.
 */
export async function GET(req: NextRequest) {
  // Vercel 크론은 **GET** 으로 온다 — 기계 호출이면 POST 와 같은 전 워크스페이스 경로다.
  // 이 분기가 없어서 vercel.json 에 등록해 둔 크론이 계속 403 이었다(실측 2026-08-21).
  if (isMachineCall(req)) {
    const ids = await allWorkspaceIds()
    return Response.json({ workspaces: ids.length, results: await runFor(ids) })
  }

  const access = await resolveCrmAccess()
  if (!access.ok) {
    return Response.json({ error: { message: '영업 CRM 멤버만 실행할 수 있습니다' } }, { status: 403 })
  }
  return Response.json({ expired: await expireSuggestions(access.session.workspaceId) })
}
