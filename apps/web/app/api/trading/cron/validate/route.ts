// GET/POST /api/trading/cron/validate — 검증을 한 바퀴 돌린다
//
// 매분 도는 수집(`cron/tick`)과 달리 이것은 **가끔** 부른다. 한 바퀴가 길고,
// 결과가 달라지려면 봉이 며칠은 더 쌓여야 한다.
//
// 사람 세션이 없는 창구라 기존 기계 인증을 그대로 쓴다. 새 인증을 만들지 않는다.

import { NextResponse } from 'next/server'
import { isMachineCall, machineAuthUnconfigured } from '@/lib/crm/jobs/machine-auth'
import { runValidation } from '@/lib/trading/validation/pipeline'
import { loadTradingSettings } from '@/lib/trading/settings/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function validate(req: Request) {
  if (machineAuthUnconfigured()) {
    return NextResponse.json({ error: '크론 인증이 설정되지 않았습니다.' }, { status: 503 })
  }
  if (!isMachineCall(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)

  try {
    const { values } = await loadTradingSettings(today)
    const contractCode = String(values.front_contract_code_override ?? '').trim()
    if (contractCode === '') {
      // 근월물을 모르면 무엇을 검증할지 모른다. 조용히 0건으로 끝내지 않는다
      return NextResponse.json({
        ok: false, reason: 'no_contract',
        userMessage: '검증할 월물이 없습니다. 수집이 먼저 돌아야 합니다',
      }, { status: 409 })
    }

    const result = await runValidation({ contractCode, now })
    return NextResponse.json(result, { status: result.ok ? 200 : 409 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류'
    return NextResponse.json(
      { ok: false, reason: `threw:${message}`, userMessage: '검증이 실패했습니다' },
      { status: 500 },
    )
  }
}

export async function GET(req: Request) { return validate(req) }
export async function POST(req: Request) { return validate(req) }
