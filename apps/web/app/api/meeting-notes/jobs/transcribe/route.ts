// 회의 녹음 전사 잡 — 크론 + 업로드 킥 (통합 기획 §5-3)
//
// 입구 판정은 machine-auth.ts(SSOT)를 쓴다. 새 인증 방식을 만들지 않는다 —
// 입구가 두 종류면 한쪽만 잠그게 되고, 이 저장소에서 크론 잡 3개가
// 8시간 내내 403 이던 사고가 정확히 그것이었다.
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isMachineCall, machineAuthUnconfigured } from '@/lib/crm/jobs/machine-auth'
import { drainTranscription } from '@/lib/meeting/transcribe-parts'

export const runtime = 'nodejs'
export const maxDuration = 300

const DEADLINE_MS = 240_000
const MAX_PARTS_PER_TICK = 8

async function run(req: NextRequest) {
  if (machineAuthUnconfigured()) {
    return NextResponse.json(
      { error: '잡 토큰이 설정되지 않아 실행할 수 없습니다 (CRON_SECRET 또는 CI_WORKER_TOKEN).' },
      { status: 500 },
    )
  }
  if (!isMachineCall(req)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: metaRow } = await admin.from('org_content').select('value').eq('key', 'META').single()
  const result = await drainTranscription({
    meta: (metaRow?.value as Record<string, unknown>) ?? {},
    limit: MAX_PARTS_PER_TICK,
    deadlineMs: DEADLINE_MS,
  })
  return NextResponse.json(result)
}

// 크론은 GET 으로 부르고, 외부 스케줄러는 POST 로 부른다. 둘 다 연다.
export const GET = run
export const POST = run
