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

import { loadTradingSettings } from '../settings/store.ts'
import { loadSessionWindow } from '../calendar/seed.ts'
import { isContinuousTrading } from '../calendar/session.ts'
import { syncContracts } from '../contracts/sync.ts'
import { getAccessToken } from '../broker/token.ts'
import { loadAppCredential } from '../broker/credentials.ts'
import { createKisClient } from '../broker/kis-client.ts'
import { decideBarConfirmation, targetMinuteFor } from '../bars/confirm.ts'
import { saveBars, loadBarsAsOf } from '../bars/store.ts'
import { computeIndicators, evaluateTriggers, requiredBarCount } from '../judge/indicators.ts'
import { createRuleJudge } from '../judge/rule.ts'
import { createServerJevJudge } from '../judge/jev.ts'
import { runJudges, scheduledMinuteOf } from './tick-core.ts'
import {
  claimJudgment, takeOverStaleClaim, finishJudgment,
  startJobRun, finishJobRun,
} from './claim.ts'
import type { Judge, JudgeName } from '../judge/types.ts'

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

  // 1 이 분을 내가 맡는가
  const mine = await startJobRun(TICK_JOB_NAME, scheduledMinute)
  if (!mine) {
    return { ok: true, reason: 'already_running', userMessage: null }
  }

  try {
    const result = await tickBody(now, runId)
    await finishJobRun({
      jobName: TICK_JOB_NAME,
      scheduledMinute,
      status: result.ok ? 'done' : 'failed',
      reason: result.reason,
      userMessage: result.userMessage,
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류'
    await finishJobRun({
      jobName: TICK_JOB_NAME,
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

  // 2 오늘 거래일인가
  const window = await loadSessionWindow(today)
  if (!window) {
    return { ok: true, reason: 'no_session_row', userMessage: '오늘 세션 정보가 없어 건너뜁니다' }
  }

  const root = str('instrument_root', 'MINI_KOSPI200') as 'KOSPI200' | 'MINI_KOSPI200'
  const sync = await syncContracts({
    root,
    overrideFrontCode: str('front_contract_code_override', ''),
    today,
  })
  if (!sync.frontCode) {
    return { ok: false, reason: sync.reason, userMessage: sync.userMessage }
  }
  const contractCode = sync.frontCode

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

  // 3 직전 1분 봉이 확정됐나
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

  // 호가는 봉에 없어서 따로 받는다. 못 받아도 봉 저장은 막지 않는다
  const quote = await kis.askingPrice(contractCode)
  const bestBid = quote.ok ? Number(quote.value.futs_bidp1) : NaN
  const bestAsk = quote.ok ? Number(quote.value.futs_askp1) : NaN

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
  })

  // 단일가 구간의 봉은 모으되 판단하지 않는다(§6.3 D-40)
  if (!isContinuousTrading(window, target)) {
    return { ok: true, reason: 'not_continuous_trading', userMessage: null }
  }

  // 4 진입 조건이 걸렸나
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
    return { ok: true, reason: 'no_trigger', userMessage: null }
  }

  // 5 선점한 판단기만 부른다
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
    tradingLogicVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
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
      finish: async (id, _judge, result, at) => {
        await finishJudgment(id, {
          status: result.status,
          rawScore: result.status === 'completed' ? { ...result.rawScore } : null,
          abstainReason: result.status === 'completed' ? null : result.abstainReason,
          decisionAt: at,
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
