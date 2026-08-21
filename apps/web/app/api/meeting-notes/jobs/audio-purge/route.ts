// 회의 녹음 원본 자동 삭제 잡 (사용자 결정 D2 — 자동삭제 적용)
//
// 전사가 끝난 뒤 보관 기간이 지난 오디오를 드라이브에서 지운다.
// 입구 판정은 machine-auth.ts(SSOT)를 쓴다 — 크론은 GET, 외부 스케줄러는 POST 로 부른다.
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isMachineCall, machineAuthUnconfigured } from '@/lib/crm/jobs/machine-auth'
import { purgeExpiredAudio, PURGE_BATCH } from '@/lib/meeting/audio-purge'

export const runtime = 'nodejs'
export const maxDuration = 300

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

  const result = await purgeExpiredAudio({
    meta: (metaRow?.value as Record<string, unknown>) ?? {},
    nowIso: new Date().toISOString(),
    limit: PURGE_BATCH,
  })
  return NextResponse.json(result)
}

export const GET = run
export const POST = run
