// GET/POST /api/trading/cron/tick — 1분마다 봉을 확정하고 판단을 기록한다
//
// **GET 과 POST 를 둘 다 연다.** Vercel 크론은 GET 으로 부르고, pg_cron 은 POST 로 부른다.
// POST 만 열어 뒀다가 8시간 내내 403 이 난 전례가 있다(v0.7.572).
//
// **사람 세션이 없는 창구다.** 화면 API 와 인증 축이 달라서 기존 기계 인증
// (`isMachineCall` — CRON_SECRET / CI_WORKER_TOKEN)을 그대로 쓴다. 소유자 확인은
// 여기 붙이지 않는다 — 부르는 쪽이 사람이 아니다.
//
// **1분 안에 끝나야 한다.** Jev 대기가 10초이고 월물 조회가 여러 번이라
// 실행 한도를 명시하고, 50초가 넘으면 남은 일은 다음 실행으로 넘긴다(§14.3).

import { NextResponse } from 'next/server'
import { isMachineCall, machineAuthUnconfigured } from '@/lib/crm/jobs/machine-auth'
import { runTick } from '@/lib/trading/jobs/tick'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function tick(req: Request) {
  if (machineAuthUnconfigured()) {
    return NextResponse.json({ error: '크론 인증이 설정되지 않았습니다.' }, { status: 503 })
  }
  if (!isMachineCall(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const now = new Date()
  // 이 실행의 이름. 토큰 잠금 주인 자리에 적혀 「누가 재발급 중인가」를 말한다
  const runId = `tick-${now.toISOString()}`

  try {
    const result = await runTick(now, runId)
    return NextResponse.json(result, { status: result.ok ? 200 : 503 })
  } catch (error) {
    // 조용히 200 을 주지 않는다 — 실패가 성공으로 보이면 결측을 아무도 못 본다
    const message = error instanceof Error ? error.message : '알 수 없는 오류'
    return NextResponse.json(
      { ok: false, reason: `threw:${message}`, userMessage: '트레이딩 수집이 실패했습니다' },
      { status: 500 },
    )
  }
}

export async function GET(req: Request) { return tick(req) }
export async function POST(req: Request) { return tick(req) }
