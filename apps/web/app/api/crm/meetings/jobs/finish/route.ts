// app/api/crm/meetings/jobs/finish/route.ts — 끝내기 잡 드레인 (입구 둘)
//
// **POST = 브라우저.** 화면을 보고 있는 동안은 브라우저가 짧게 반복해 때린다.
//   의존성이 0이고, 크론(2분)보다 촘촘하다. 인증은 **세션**이다 —
//   서비스 토큰을 브라우저에 내려보내면 큐가 외부에 열린다.
//   (가드가 이 파일에 서비스 토큰 이름이 등장하는 것 자체를 막는다. 적어두면 언젠가 복사된다)
//
// **GET = 크론.** 화면을 닫아도 일이 끝나게 하는 백스톱이다. 판정은 `machine-auth`(SSOT)를
//   그대로 쓴다 — 입구가 두 종류면 한쪽만 잠그게 되고, 이 저장소에서 크론 잡 3개가
//   8시간 내내 403 이던 사고가 정확히 그것이었다.
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isMachineCall, machineAuthUnconfigured } from '@/lib/crm/jobs/machine-auth'
import { drainFinishJobs } from '@/lib/crm/jobs/finish-drain'
import { finishDrainDeps } from '@/lib/crm/jobs/finish-deps'
import { withCrmApi } from '@/lib/crm/api/handler'

export const runtime = 'nodejs'
export const maxDuration = 300

/** 한 회차의 예산. 상한보다 짧게 잡아 마지막 저장이 잘리지 않게 한다 */
const DEADLINE_MS = 250_000
/** 한 회차가 집는 잡 수. 회의 정리는 한 건이 무겁다 */
const LIMIT = 2

/** 브라우저가 반복해 때리는 것을 싸게 막는다. 진짜 방어선은 잡 임대가 원자적이라는 것 */
const MIN_INTERVAL_MS = 1_500
const lastRunAt = new Map<string, number>()

function tooSoon(workspaceId: string, now: number): boolean {
  const prev = lastRunAt.get(workspaceId)
  if (prev !== undefined && now - prev < MIN_INTERVAL_MS) return true
  lastRunAt.set(workspaceId, now)
  if (lastRunAt.size > 500) {
    lastRunAt.forEach((at, key) => { if (now - at > 60_000) lastRunAt.delete(key) })
  }
  return false
}

async function drain(deadlineMs: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  return drainFinishJobs(admin, { ...(await finishDrainDeps()), deadlineMs, limit: LIMIT })
}

/** 크론 — 화면이 닫혀 있을 때의 백스톱 */
export async function GET(req: NextRequest) {
  if (machineAuthUnconfigured()) {
    return NextResponse.json(
      { error: '잡 토큰이 설정되지 않아 실행할 수 없습니다 (CRON_SECRET 또는 CI_WORKER_TOKEN).' },
      { status: 500 },
    )
  }
  if (!isMachineCall(req)) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  return NextResponse.json(await drain(Date.now() + DEADLINE_MS))
}

/** 브라우저 — 화면을 보는 동안은 이쪽이 더 촘촘하다 */
export async function POST() {
  return withCrmApi('MEMBER', async ({ session }) => {
    if (tooSoon(session.workspaceId, Date.now())) return { skipped: 'too_soon' as const }
    return drain(Date.now() + DEADLINE_MS)
  })
}
