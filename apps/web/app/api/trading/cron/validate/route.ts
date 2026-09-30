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
import { pickFrontContract } from '@/lib/trading/contracts/front'
import { startJobRun, finishJobRun } from '@/lib/trading/jobs/claim'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * 실행 기록에 남길 이름. **수집과 다른 이름이어야 한다** —
 * `(job_name, scheduled_minute)` 이 유일 키라 이름이 같으면 같은 분을 두고 다툰다
 */
const JOB_NAME = 'trading-validate'

async function validate(req: Request) {
  if (machineAuthUnconfigured()) {
    return NextResponse.json({ error: '크론 인증이 설정되지 않았습니다.' }, { status: 503 })
  }
  if (!isMachineCall(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)

  /*
    **자기 실행을 남긴다.**

    실측 2026-09-30: `trading_job_runs` 에 이 일이 **한 줄도 없었다**(있는 것은
    `trading-tick` 뿐). 그래서 검증이 왜 안 도는지 화면에서 볼 길이 없었고,
    사람은 「표본이 모자란가 보다」로 읽으며 기다렸다
    (사용자 개입 2026-09-30 「검증쪽은 뭐가 다 없대 이상하네」).

    분 단위로 자른다 — 같은 분에 두 번 들어오면 둘째는 안 돈다.
  */
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000)
  const mine = await startJobRun(JOB_NAME, minute).catch(() => false)

  const close = async (
    status: 'done' | 'failed' | 'skipped',
    reason: string | null,
    userMessage: string | null,
  ): Promise<void> => {
    if (mine) await finishJobRun({ jobName: JOB_NAME, scheduledMinute: minute, status, reason, userMessage })
  }

  try {
    const { values } = await loadTradingSettings(today)
    /*
      **덮어쓰기 하나만 보면 안 된다.**

      실측 2026-09-30: `front_contract_code_override` 가 빈 문자열이라 이 창구가 매번
      `no_contract` 로 끝나고 있었다 — `trading_job_runs` 에 검증이 **한 줄도 없다**.
      그동안 수집과 화면은 월물 표에서 근월물(A05610)을 제대로 찾고 있었다.
      같은 질문에 답이 둘이었고, 그중 하나만 쓰는 쪽이 조용히 멈춰 있었다.

      봉이 아무리 쌓여도 백테스트가 도는 날이 안 오므로, 화면의 관문 여덟 줄은
      영영 「아직 못 잼」이다 (사용자 개입 2026-09-30 「검증쪽은 뭐가 다 없대 이상하네」).
    */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data: front } = await admin
      .from('trading_contracts').select('code').eq('is_front', true).limit(1)
    const pick = pickFrontContract({
      override: String(values.front_contract_code_override ?? ''),
      fromTable: ((front ?? [])[0]?.code as string | undefined) ?? null,
    })
    if (!pick.code) {
      // 근월물을 모르면 무엇을 검증할지 모른다. 조용히 0건으로 끝내지 않는다
      await close('skipped', 'no_contract', pick.reason)
      return NextResponse.json({
        ok: false, reason: 'no_contract', userMessage: pick.reason,
      }, { status: 409 })
    }
    const contractCode = pick.code

    const result = await runValidation({ contractCode, now })
    /*
      **못 돈 것도 끝난 것이다.** 아직 못 도는 이유(거래일이 모자람 같은 것)는
      고장이 아니라 사실이므로 `skipped` 로 남긴다 — `failed` 로 적으면
      운영 화면이 매일 빨개지고, 빨간 줄이 매일 있으면 아무도 안 본다.
    */
    await close(result.ok ? 'done' : 'skipped', result.reason ?? null, result.userMessage ?? null)
    return NextResponse.json(result, { status: result.ok ? 200 : 409 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류'
    // 터진 것도 남긴다 — 안 남기면 다음 사람이 「한 번도 안 돌았다」로 읽는다
    await close('failed', `threw:${message}`, '검증이 실패했습니다')
    return NextResponse.json(
      { ok: false, reason: `threw:${message}`, userMessage: '검증이 실패했습니다' },
      { status: 500 },
    )
  }
}

export async function GET(req: Request) { return validate(req) }
export async function POST(req: Request) { return validate(req) }
