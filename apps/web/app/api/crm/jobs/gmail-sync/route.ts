/**
 * Gmail 동기화 잡 (dacrm 구현명세 §3.5-1, 정정판)
 *
 * **왜 이 파일이 뒤늦게 생겼나**: `syncGmail()` 은 완성돼 있고 테스트도 통과하는데
 * **부르는 곳이 테스트뿐이었다.** 사용자가 구글 계정을 연결해도 메일은 영원히 안 들어왔다.
 * 화면에는 "연결됨"이라 떠 있으니 아무도 이상하다고 생각하지 않는다 —
 * 이 저장소가 반복해 온 "만들어놓고 안 부르는" 사고의 정확한 재현이었다.
 *
 * 두 가지 방법으로 부를 수 있게 둔다.
 *   · **크론**(Vercel) — 사람이 없어도 15분마다 돈다. 이게 주 경로다.
 *   · **사람이 직접** — 설정 화면의 "지금 가져오기". 방금 연결한 사람이
 *     15분을 기다려야 첫 메일을 보는 건 "연동이 안 되는 것"과 구분이 안 된다.
 *
 * 인증은 CI 워커와 같은 모양이다(토큰 없으면 통과가 아니라 거부).
 * 새 방식을 만들지 않는다 — 잡 입구가 두 종류면 한쪽만 잠그게 된다.
 */
import type { NextRequest } from 'next/server'
import { syncGmail } from '@/lib/crm/integrations/gmail'
import { googleGmailAdapter } from '@/lib/crm/integrations/gmail-google'
import { getCrmAccessToken } from '@/lib/crm/integrations/connect'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveCrmAccess } from '@/lib/crm/auth/requireCrmMember'
import { isMachineCall, machineAuthUnconfigured } from '@/lib/crm/jobs/machine-auth'

export const maxDuration = 60

/** 한 번에 도는 연결 수 — 계정이 늘어도 한 판이 60초를 안 넘게 */
const MAX_CONNECTIONS = 20

interface ConnRow { id: string; workspaceId: string; memberId: string }

/**
 * 살아 있는 연결을 전부 훑는다.
 *
 * 서비스롤로 읽는 이유: 크론에는 로그인 세션이 없다.
 * 워크스페이스 경계는 `syncGmail` 이 각 연결의 workspaceId 로 다시 건다.
 */
async function activeConnections(workspaceId?: string): Promise<ConnRow[]> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (admin as any)
    .from('crm_integration_connection')
    .select('id, workspaceId, memberId')
    .eq('provider', 'google')
    .eq('status', 'active')
    .limit(MAX_CONNECTIONS)
  if (workspaceId) q = q.eq('workspaceId', workspaceId)
  const { data } = await q
  return (data ?? []) as ConnRow[]
}

async function runFor(conns: ConnRow[]) {
  const results: Record<string, unknown>[] = []

  for (const c of conns) {
    // 토큰이 만료됐으면 갱신해서 돌려준다. 갱신도 실패하면 그 연결은 error 로 표시돼 있다.
    const token = await getCrmAccessToken(c.workspaceId, c.id)
    if (!token) {
      results.push({ connectionId: c.id, skipped: '다시 연결이 필요합니다' })
      continue
    }
    try {
      const r = await syncGmail(c.workspaceId, c.id, googleGmailAdapter(), token)
      results.push({ connectionId: c.id, ...r })
    } catch (e) {
      // 한 계정이 실패해도 나머지는 돌아야 한다 — 한 사람 때문에 팀 전체가 멈추면 안 된다
      console.error('[crm/gmail-sync] 실패:', c.id, e)
      results.push({ connectionId: c.id, error: e instanceof Error ? e.message : String(e) })
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

  const conns = await activeConnections()
  return Response.json({ connections: conns.length, results: await runFor(conns) })
}

/**
 * 사람이 "지금 가져오기"를 눌렀을 때 — 자기 워크스페이스만.
 *
 * 방금 연결한 사람이 첫 메일을 보려고 15분을 기다리게 두면
 * 사용자는 연동이 안 되는 줄 안다.
 */
export async function GET(req: NextRequest) {
  // Vercel 크론은 **GET** 으로 온다 — 기계 호출이면 POST 와 같은 전 워크스페이스 경로다.
  // 이 분기가 없어서 vercel.json 에 등록해 둔 크론이 계속 403 이었다(실측 2026-08-21).
  if (isMachineCall(req)) {
    const all = await activeConnections()
    return Response.json({ connections: all.length, results: await runFor(all) })
  }

  const access = await resolveCrmAccess()
  if (!access.ok) {
    return Response.json({ error: { message: '영업 CRM 멤버만 실행할 수 있습니다' } }, { status: 403 })
  }
  const conns = await activeConnections(access.session.workspaceId)
  return Response.json({ connections: conns.length, results: await runFor(conns) })
}
