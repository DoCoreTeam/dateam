/**
 * 오래 머문 딜 훑기 잡 (dacrm FR-08 `deal.stalled`)
 *
 * **왜 크론이 필요한가**: 다른 트리거는 사람이 무언가를 할 때 발화한다.
 * 그런데 "오래 머물렀다"는 **아무 일도 안 일어난 것**이 사건이라 발화할 자리가 없다.
 * 이 잡이 없으면 그 트리거는 설정 화면에만 있고 **영영 안 도는 기능**이 된다.
 *
 * 입구 모양은 expire-suggestions 와 같다 — 입구가 두 종류면 한쪽만 잠그게 된다.
 */
import type { NextRequest } from 'next/server'
import { getCrmDb } from '@/lib/crm/db/client'
import { withCrmTx } from '@/lib/crm/db/tx'
import { runStalledSweep } from '@/lib/crm/services/automation'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveCrmAccess } from '@/lib/crm/auth/requireCrmMember'
import { isMachineCall, machineAuthUnconfigured } from '@/lib/crm/jobs/machine-auth'

export const maxDuration = 60

/** 한 판에 도는 워크스페이스 수 */
const MAX_WORKSPACES = 50

async function allWorkspaceIds(): Promise<string[]> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any).from('crm_workspace').select('id').limit(MAX_WORKSPACES)
  return ((data ?? []) as { id: string }[]).map((w) => w.id)
}

async function sweep(workspaceId: string) {
  const db = getCrmDb(workspaceId)
  return runStalledSweep(db, (fn) => withCrmTx(workspaceId, fn))
}

/**
 * 전 워크스페이스 훑기 — 크론(GET)과 외부 스케줄러(POST)가 **같은 함수**를 쓴다.
 * 예전엔 이 루프가 POST 안에만 있어서, GET 으로 오는 Vercel 크론은 닿을 수가 없었다.
 */
async function runAll() {
  const ids = await allWorkspaceIds()
  const results: Record<string, unknown>[] = []
  for (const id of ids) {
    try {
      results.push({ workspaceId: id, ...(await sweep(id)) })
    } catch (e) {
      // 한 워크스페이스가 실패해도 나머지는 돌아야 한다
      console.error('[crm/stalled-deals] 실패:', id, e)
      results.push({ workspaceId: id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { workspaces: ids.length, results }
}

/** 크론 전용 — 전 워크스페이스 */
export async function POST(req: NextRequest) {
  if (machineAuthUnconfigured()) {
    return Response.json({ error: { message: '워커 토큰이 설정되지 않았습니다' } }, { status: 500 })
  }
  if (!isMachineCall(req)) {
    return Response.json({ error: { message: '워커 토큰이 올바르지 않습니다' } }, { status: 401 })
  }

  return Response.json(await runAll())
}

/**
 * 사람이 직접 — 자기 워크스페이스만.
 *
 * 크론이 주 경로지만, 크론이 아직 안 붙은 환경에서도 규칙을 만든 사람이
 * "이게 진짜 도나"를 확인할 수 있어야 한다.
 */
export async function GET(req: NextRequest) {
  // Vercel 크론은 **GET** 으로 온다 — 기계 호출이면 POST 와 같은 전 워크스페이스 경로다.
  // 이 분기가 없어서 vercel.json 에 등록해 둔 크론이 계속 403 이었다(실측 2026-08-21).
  if (isMachineCall(req)) return Response.json(await runAll())

  const access = await resolveCrmAccess()
  if (!access.ok) {
    return Response.json({ error: { message: '영업 CRM 멤버만 실행할 수 있습니다' } }, { status: 403 })
  }
  return Response.json(await sweep(access.session.workspaceId))
}
