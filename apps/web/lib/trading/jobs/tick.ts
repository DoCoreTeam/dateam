import 'server-only'

/**
 * 매분 하는 일 — **지금 할 일을 코드가 판단한다** (명세 §4)
 *
 * 크론은 가끔 빠지고 가끔 두 번 된다. 그래서 「5초에 이것, 10초에 저것」으로 짜지 않고
 * 매분 불러 놓고 **무엇을 할 차례인지 여기서 판단한다.** 중복은 유일 키와 선점이 막는다.
 *
 * 순서가 곧 규칙이다.
 *   1 이 분을 내가 맡는가          — 아니면 남이 이미 돌고 있다
 *   2 오늘 거래일인가 · 접속매매인가 — 아니면 수집만 하고 판단은 안 한다
 *   3 직전 1분 봉이 확정됐나        — 아니면 결측으로 적고 그 분은 건너뛴다
 *   4 진입 조건이 걸렸나            — 아니면 판단기를 안 부른다
 *   5 선점한 판단기만 부른다        — 밖으로 나가는 것은 여기 하나뿐이다
 */

import { createAdminClient } from '@/lib/supabase/server'
import { currentDeployEnv, type DeployEnv } from '@/lib/ai/deploy-env'
import { loadTradingSettings, seedTradingSettings } from '../settings/store.ts'
import { ensureSessionWindow } from '../calendar/seed.ts'
import { loadDayConfig, freezeDayConfig, logicChangedToday } from './day-config.ts'
import { isContinuousTrading } from '../calendar/session.ts'
import { syncContracts } from '../contracts/sync.ts'
import { getAccessToken } from '../broker/token.ts'
import { loadAppCredential } from '../broker/credentials.ts'
import { createKisClient } from '../broker/kis-client.ts'
import { decideBarConfirmation, targetMinuteFor } from '../bars/confirm.ts'
import { saveBars, loadBarsAsOf } from '../bars/store.ts'
import { aggregateBars } from '../bars/confirm.ts'
import { bucketsClosedBy, openInterestOf } from '../bars/rollup.ts'
import { computeIndicators, evaluateTriggers, requiredBarCount } from '../judge/indicators.ts'
import { createRuleJudge } from '../judge/rule.ts'
import { createServerJevJudge } from '../judge/jev.ts'
import { runJudges, scheduledMinuteOf } from './tick-core.ts'
import {
  claimJudgment, takeOverStaleClaim, finishJudgment,
  startJobRun, finishJobRun,
} from './claim.ts'
import type { Judge, JudgeName } from '../judge/types.ts'

/**
 * 실행 이름 — **판마다 다르다.**
 *
 * `(job_name, scheduled_minute)` 이 유일 키라 이름이 같으면 운영과 개발이 **같은 분을 두고 다툰다.**
 * 실측 2026-09-26: 로컬 격리 서버가 크론을 부를 때마다 `already_running` 이 돌아왔다 —
 * 배포된 운영 크론이 그 분을 이미 잡고 있었기 때문이다.
 *
 * 개발이 이기면 더 나쁘다. 운영은 「남이 돌고 있다」로 넘어가고, 정작 수집은
 * **키도 설정도 다른 개발 기계**가 한다. 그래서 판을 이름에 박는다.
 */
export function tickJobName(env: DeployEnv = currentDeployEnv()): string {
  return env === 'production' ? 'trading-tick' : `trading-tick@${env}`
}

/** 운영 이름. 화면과 조회가 기본으로 보는 값 */
export const TICK_JOB_NAME = 'trading-tick'

export interface TickResult {
  ok: boolean
  /** 기계가 읽는 사유. 성공이어도 어느 길로 갔는지 남긴다 */
  reason: string
  userMessage: string | null
  ran?: JudgeName[]
  skipped?: JudgeName[]
  deferred?: JudgeName[]
}

function seoulToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
}

/**
 * @param now 실행 시각. 시험과 재현을 위해 받는다
 * @param runId 이 실행의 이름. 토큰 잠금 주인 자리에 적힌다
 */
export async function runTick(now: Date, runId: string): Promise<TickResult> {
  const scheduledMinute = scheduledMinuteOf(now)
  const jobName = tickJobName()

  // 1 이 분을 내가 맡는가 — 같은 판 안에서만 다툰다
  const mine = await startJobRun(jobName, scheduledMinute)
  if (!mine) {
    return { ok: true, reason: 'already_running', userMessage: null }
  }

  try {
    const result = await tickBody(now, runId)
    await finishJobRun({
      jobName,
      scheduledMinute,
      status: result.ok ? 'done' : 'failed',
      reason: result.reason,
      userMessage: result.userMessage,
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류'
    await finishJobRun({
      jobName,
      scheduledMinute,
      status: 'failed',
      reason: `threw:${message}`,
      userMessage: '트레이딩 수집이 실패했습니다',
    })
    // 삼키지 않는다. 라우트가 500 을 주고 그 사실이 배포 로그에도 남아야 한다
    throw error
  }
}

async function tickBody(now: Date, runId: string): Promise<TickResult> {
  const today = seoulToday(now)
  const { values, version: settingsVersion } = await loadTradingSettings(today)
  const num = (key: string, fallback: number) => {
    const value = Number(values[key])
    return Number.isFinite(value) ? value : fallback
  }
  const str = (key: string, fallback: string) => {
    const value = values[key]
    return typeof value === 'string' && value !== '' ? value : fallback
  }

  const logicVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? null

  /**
   * 2 오늘 근월물 — **하루에 한 번만 정한다** (§14.4 · §6.3)
   *
   * `syncContracts` 는 92KB 마스터를 내려받는다. 분마다 부르면 하루 1,440번이다.
   * 그래서 그날 굳혀 둔 값이 있으면 그것을 읽고, 없을 때만 받아서 굳힌다.
   *
   * 세션보다 먼저 정하는 이유: 그날이 만기일이면 접속매매가 15:20 에 끝나는데
   * 그 사실은 **월물의 최종거래일**에서만 나온다. 순서를 뒤집으면 만기일마다
   * 15분 늦은 창을 세우고 그 시간의 단일가 봉으로 판단하게 된다.
   */
  const frozen = await loadDayConfig(today)
  let contractCode: string
  let expiryDays: Set<string>
  let syncReason = 'day_config_frozen'

  if (frozen) {
    contractCode = frozen.frontContractCode
    // 굳은 날에는 마스터를 안 받는다. 최종거래일은 이미 trading_contracts 에 있다
    expiryDays = await loadLastTradingDays()
    if (logicChangedToday(frozen, logicVersion)) {
      // 막지는 않는다(1-A 는 신호를 안 낸다). 그날을 갈라 셀 수 있게 사실만 남긴다
      syncReason = `logic_changed:${frozen.tradingLogicVersion}->${logicVersion}`
    }
  } else {
    const root = str('instrument_root', 'MINI_KOSPI200') as 'KOSPI200' | 'MINI_KOSPI200'
    const sync = await syncContracts({
      root,
      overrideFrontCode: str('front_contract_code_override', ''),
      today,
    })
    if (!sync.frontCode) {
      return { ok: false, reason: sync.reason, userMessage: sync.userMessage }
    }
    contractCode = sync.frontCode
    expiryDays = new Set(sync.contracts.map((c) => c.lastTradingDay))

    /**
     * 그날 처음 도는 실행이 설정 초기값도 심는다.
     *
     * 안 심으면 `settings_version` 이 영원히 0 이고, 「그날 무엇으로 판단했나」를
     * 되짚을 근거가 없다. 이미 있는 키는 안 건드린다(관리자가 바꾼 값이 되돌아가면 안 된다).
     */
    const seeded = await seedTradingSettings(today)
    const after = seeded.seeded.length > 0 ? await loadTradingSettings(today) : null

    await freezeDayConfig({
      tradeDate: today,
      tradingLogicVersion: logicVersion ?? 'unknown',
      settingsVersion: after?.version ?? settingsVersion,
      frontContractCode: contractCode,
    })
    syncReason = seeded.seeded.length > 0
      ? `${sync.reason},settings_seeded=${seeded.seeded.length}`
      : sync.reason
  }

  /**
   * 3 오늘 세션 창 — **없으면 세운다.**
   *
   * 예전에는 없으면 그냥 건너뛰었다. 채우는 함수는 있었는데 아무도 안 불러서
   * 캘린더가 영원히 비었고, 크론은 매분 「세션 정보가 없어 건너뜁니다」로 끝났다.
   * 봉이 한 줄도 안 쌓이는데 오류는 한 건도 안 났다(실측 2026-09-26).
   */
  const session = await ensureSessionWindow(today, expiryDays)
  const window = session.window
  if (!window) {
    return { ok: true, reason: `${session.reason}|${syncReason}`, userMessage: null }
  }

  const env = str('kis_env', 'real') as 'real' | 'paper'
  const token = await getAccessToken({
    env,
    refreshMarginMinutes: num('kis_token_refresh_margin_minutes', 30),
    runId,
    now,
  })
  if (!token.ok) {
    // 조회가 막힌 것은 수집 공백이다. 조용히 넘어가면 결측과 구분되지 않는다
    return { ok: false, reason: token.reason, userMessage: token.userMessage }
  }

  const credential = await loadAppCredential(env)
  if (!credential) {
    return { ok: false, reason: 'no_credential', userMessage: '증권사 앱키가 등록되지 않았습니다' }
  }

  const kis = createKisClient({
    env,
    auth: { accessToken: token.accessToken, appKey: credential.appKey, appSecret: credential.appSecret },
    minIntervalMs: num('kis_min_interval_ms', 200),
  })

  // 4 직전 1분 봉이 확정됐나
  const target = targetMinuteFor(now)
  const fetched = await kis.minuteBars({
    contractCode,
    from: new Date(target.getTime() - 60_000 * 5),
    until: now,
  })
  if (!fetched.ok) {
    return { ok: false, reason: fetched.reason, userMessage: fetched.userMessage }
  }

  const decision = decideBarConfirmation({
    target,
    now,
    bars: fetched.value.bars,
    graceSec: num('bar_grace_seconds', 10),
    missingAfterSec: num('bar_missing_after_seconds', 25),
  })

  if (decision.kind === 'retry') {
    return { ok: true, reason: 'bar_not_ready', userMessage: null }
  }
  if (decision.kind === 'missing') {
    // 결측은 그 분의 판단을 건너뛰고 **사실을 남긴다**. 늦게 온 값으로 다시 판단하지 않는다
    return { ok: true, reason: `bar_missing:${target.toISOString()}`, userMessage: null }
  }

  /**
   * 호가와 시세는 봉에 없어서 따로 받는다(명세 §6.1 이 최우선 호가와 미결제약정을 수집 항목에 넣는다).
   * **못 받아도 봉 저장은 안 막는다** — 모으는 일이 먼저고, 못 받은 사실은 사유로 남는다.
   */
  const quote = await kis.askingPrice(contractCode)
  const price = await kis.price(contractCode)
  const bestBid = quote.ok ? Number(quote.value.futs_bidp1) : NaN
  const bestAsk = quote.ok ? Number(quote.value.futs_askp1) : NaN
  const sideFailures = [
    quote.ok ? null : `askingPrice:${quote.reason}`,
    price.ok ? null : `price:${price.reason}`,
  ].filter((x): x is string => x !== null)

  await saveBars({
    contractCode,
    tf: '1m',
    bars: [decision.bar],
    confirmedAt: now,
    source: 'kis',
    quote: {
      bestBid: Number.isFinite(bestBid) ? bestBid : null,
      bestAsk: Number.isFinite(bestAsk) ? bestAsk : null,
    },
    openInterest: openInterestOf(price.ok ? price.value : null),
  })

  /**
   * 묶음 봉 — 방금 확정한 분이 구간을 **닫을 때만** 만든다.
   *
   * `aggregateBars` 는 구성 1분 봉이 전부 있어야 만들고, 하나라도 빠지면 안 만든다.
   * 그래서 여기서는 그 구간을 통째로 읽어 넘기기만 한다.
   */
  const rolledUp: string[] = []
  for (const bucket of bucketsClosedBy(decision.bar.startAt)) {
    const span = await loadBarsAsOf({
      contractCode, tf: '1m', asOf: now, limit: 60,
    })
    const inBucket = span.filter((b) =>
      b.startAt.getTime() >= bucket.from.getTime() &&
      b.startAt.getTime() <= decision.bar.startAt.getTime())
    const { bars: rolled, incomplete } = aggregateBars(inBucket, bucket.tf)
    if (rolled.length > 0) {
      await saveBars({
        contractCode, tf: bucket.tf, bars: rolled, confirmedAt: now, source: 'kis',
        openInterest: openInterestOf(price.ok ? price.value : null),
      })
      rolledUp.push(bucket.tf)
    } else if (incomplete > 0) {
      // 빠진 분이 있어 안 만들었다. 조용히 넘기면 5분 봉 구멍이 안 보인다
      rolledUp.push(`${bucket.tf}:incomplete`)
    }
  }

  const collectNote = [
    rolledUp.length > 0 ? `rollup=${rolledUp.join('+')}` : null,
    sideFailures.length > 0 ? `side_failed=${sideFailures.join('+')}` : null,
  ].filter(Boolean).join(',')

  // 단일가 구간의 봉은 모으되 판단하지 않는다(§6.3 D-40)
  if (!isContinuousTrading(window, target)) {
    return { ok: true, reason: `not_continuous_trading${collectNote ? `|${collectNote}` : ''}`, userMessage: null }
  }

  // 5 진입 조건이 걸렸나
  const params = {
    atrPeriod: num('atr_period', 14),
    smaFastPeriod: num('sma_fast_period', 5),
    smaSlowPeriod: num('sma_slow_period', 20),
    breakoutPeriod: num('breakout_period', 20),
    breakoutAtrMultiple: num('breakout_atr_multiple', 0.1),
  }
  const bars = await loadBarsAsOf({
    contractCode,
    tf: '1m',
    asOf: now,
    limit: requiredBarCount(params) + 5,
  })
  const indicators = computeIndicators(bars, params)
  if (!indicators) {
    return { ok: true, reason: `not_enough_bars:${bars.length}`, userMessage: null }
  }

  const trigger = evaluateTriggers(bars, indicators, params)
  if (!trigger) {
    return { ok: true, reason: `no_trigger${collectNote ? `|${collectNote}` : ''}`, userMessage: null }
  }

  // 6 선점한 판단기만 부른다
  const judges = new Map<JudgeName, Judge>([['rule', createRuleJudge()]])
  const jevModel = str('jev_model', '')
  let jevUnavailable: string | null = null
  if (jevModel !== '') {
    try {
      judges.set('jev', await createServerJevJudge({
        timeoutMs: num('jev_timeout_seconds', 10) * 1000,
        model: jevModel,
      }))
    } catch (error) {
      // Jev 를 못 만들어도 rule 기록은 남긴다. 사유는 실행 기록에 실어 보낸다
      jevUnavailable = error instanceof Error ? error.message : 'jev_unavailable'
    }
  } else {
    jevUnavailable = 'jev_model_not_set'
  }

  const barCloseAt = new Date(target.getTime() + 60_000)
  const specVersion = str('decision_spec_version', 'v1')
  const key = (judge: JudgeName) => ({
    contractCode, decisionTf: '1m', barCloseAt, specVersion, judge,
  })
  const context = {
    triggerId: trigger.id,
    tradingLogicVersion: logicVersion,
    settingsVersion,
  }

  const outcome = await runJudges(
    [...judges.keys()],
    {
      asOf: now,
      contractCode,
      decisionTf: '1m',
      bars,
      trigger,
      minutesSinceOpen: Math.floor((target.getTime() - window.continuousStart.getTime()) / 60_000),
      indicators,
    },
    {
      claim: (judge) => claimJudgment(key(judge), context, now),
      takeOver: (judge) => takeOverStaleClaim(key(judge), now),
      judges,
      finish: async (id, _judge, result, at, timing) => {
        await finishJudgment(id, {
          status: result.status,
          rawScore: result.status === 'completed' ? { ...result.rawScore } : null,
          abstainReason: result.status === 'completed' ? null : result.abstainReason,
          decisionAt: at,
          aiRequestAt: timing.aiRequestAt,
          aiResponseAt: timing.aiResponseAt,
        })
      },
      now: () => new Date(),
    },
    now,
  )

  return {
    ok: true,
    reason: jevUnavailable ? `judged:jev_off(${jevUnavailable})` : 'judged',
    userMessage: null,
    ran: outcome.ran,
    skipped: outcome.skipped,
    deferred: outcome.deferred,
  }
}

/**
 * 상장된 월물들의 최종거래일. 굳은 날에는 마스터를 안 받으므로 표에서 읽는다.
 *
 * 세션 창을 세울 때 「오늘이 만기일인가」를 이 집합으로 답한다.
 */
async function loadLastTradingDays(): Promise<Set<string>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('trading_contracts').select('last_trading_day')
  if (error) throw new Error(`최종거래일을 읽지 못했습니다: ${error.message}`)
  return new Set(((data ?? []) as { last_trading_day: string }[]).map((r) => r.last_trading_day))
}
