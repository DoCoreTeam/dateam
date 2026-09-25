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
import { ensureSessionWindow, ensureNightWindow } from '../calendar/seed.ts'
import {
  isContinuousTrading, isNightHour, nightStartDateOf, type NightTradeDateRule,
} from '../calendar/session.ts'
import { loadDayConfig, freezeDayConfig, logicChangedToday } from './day-config.ts'

import { syncContracts } from '../contracts/sync.ts'
import { getAccessToken } from '../broker/token.ts'
import { loadAppCredential, loadAccountRef } from '../broker/credentials.ts'
import { createKisClient } from '../broker/kis-client.ts'
import { decideBarConfirmation, targetMinuteFor } from '../bars/confirm.ts'
import { saveBars, loadBarsAsOf } from '../bars/store.ts'
import { aggregateBars } from '../bars/confirm.ts'
import { bucketsClosedBy, openInterestOf } from '../bars/rollup.ts'
import { computeIndicators, evaluateTriggers, requiredBarCount } from '../judge/indicators.ts'
import { createRuleJudge } from '../judge/rule.ts'
import { createServerJevJudge } from '../judge/jev.ts'
import { runJudges, scheduledMinuteOf } from './tick-core.ts'
import { runWatch } from './watch.ts'
import { createAccountClient } from '../broker/account.ts'
import { syncFills, loadFills } from '../position/fills.ts'
import { foldFills, expectedFrom, type FoldResult } from '../position/from-fills.ts'
import { loadSignalPlan, loadProtection, type SignalPlan, type ProtectionRecord } from '../position/plan.ts'
import { emitSignal } from './emit-signal.ts'
import { runKnowledgeJob } from './knowledge-job.ts'
import { runOperatorJob } from './operator-job.ts'
import { runOrderJob } from './order-job.ts'
import { isHoldDominant } from '../judge/types.ts'
import { loadInstrumentSpec } from '../settings/store.ts'
import { sameDayExitAt } from '../calendar/session.ts'
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

/** 숫자로 읽히는 것만. 못 읽으면 null 이다 — 0 은 「값이 0」이라는 다른 사실이다 */
function finiteOrNull(raw: string | undefined): number | null {
  const value = Number(raw)
  return Number.isFinite(value) && raw !== undefined && raw !== '' ? value : null
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
  let window = session.window
  /**
   * 정규장 창이 없거나 지금이 그 밖이면 **야간장**을 본다(명세 §6.1 「야간장도 수집한다」).
   *
   * 야간 봉으로는 판단하지 않는다 — 모으는 것과 판단하는 것은 다른 일이고,
   * 명세가 「신호는 정규장만」이라고 적는다. 그래도 모아 둬야 1-B 가 그 시간대를 볼 수 있다.
   */
  const nightWanted = Boolean(values.collect_night_session) && isNightHour(now)
  let isNight = false
  if (nightWanted && (!window || !isContinuousTrading(window, targetMinuteFor(now)))) {
    const night = await ensureNightWindow(
      nightStartDateOf(now),
      str('night_trade_date_rule', 'next') as NightTradeDateRule,
    )
    if (night.window) {
      window = night.window
      isNight = true
      syncReason = `${syncReason},${night.reason}`
    }
  }

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

  /**
   * 4 **먼저 포지션을 본다** (§10.2).
   *
   * 봉 확정 뒤로 미루면 안 된다 — 봉이 결측인 분은 `return` 으로 끝나는데,
   * 그 분에도 포지션은 살아 있고 손절가를 지날 수 있다. 「어떤 경우에도 안 멈춤」이
   * 뜻하는 것이 이것이다.
   *
   * 감시가 실패해도 수집은 계속한다 — 곁가지가 본 일을 죽이지 않는다.
   */
  /**
   * 시세와 호가를 **감시보다 먼저** 받는다 (§6.1).
   *
   * 감시가 손절 이탈을 보려면 지금 값이 있어야 한다. 봉 확정 뒤로 미루면
   * 봉이 결측인 분에는 값이 아예 없는데, **그 분이야말로 우리가 눈이 먼 분**이다.
   * 봉 저장은 이 값을 나중에 쓴다 — 못 받아도 저장을 안 막는다.
   */
  const quote = await kis.askingPrice(contractCode)
  const price = await kis.price(contractCode)
  const bestBid = quote.ok ? Number(quote.value.futs_bidp1) : NaN
  const bestAsk = quote.ok ? Number(quote.value.futs_askp1) : NaN
  const sideFailures = [
    quote.ok ? null : `askingPrice:${quote.reason}`,
    price.ok ? null : `price:${price.reason}`,
  ].filter((x): x is string => x !== null)
  const observedPrice = price.ok ? finiteOrNull(price.value.futs_prpr) : null

  let watchNote = 'watch=off'
  let fillNote = 'fills=off'
  const accountRef = await loadAccountRef(env, str('kis_account_product_code', '03'))
  /**
   * 계좌 창구는 **한 벌**이다.
   *
   * 감시도 체결도 게이트도 같은 계좌를 묻는다. 각자 만들면 속도 제한 큐가 셋이 되고
   * 큐는 자기 것만 세니까 셋이 동시에 나가 KIS 제한을 넘긴다. 한 벌을 돌려 쓴다.
   */
  const account = accountRef
    ? createAccountClient({
      env,
      auth: { accessToken: token.accessToken, appKey: credential.appKey, appSecret: credential.appSecret },
      acct: accountRef,
      minIntervalMs: num('kis_min_interval_ms', 200),
      isNight,
    })
    : null

  /**
   * 체결을 먼저 읽는다 — 감시가 「우리 기록」과 계좌를 대조하는데,
   * 그 기록이 이것으로 쌓인다. 순서를 뒤집으면 늘 한 판 늦은 기록으로 대조한다.
   */
  if (account) {
    try {
      fillNote = (await syncFills(account, today.replaceAll('-', ''), now)).reason
    } catch (error) {
      fillNote = `fills_failed:${error instanceof Error ? error.message : 'unknown'}`
    }
  } else {
    fillNote = 'fills=no_account'
  }

  /**
   * 적어 둔 체결을 접어 **우리 기록의 포지션**을 세운다.
   *
   * 이 값이 비어 있으면 계좌 대조는 언제나 「계좌에만 있다」로 어긋나고,
   * 실현 손익은 언제나 0원이라 일일 손실 한도가 영영 안 걸린다. 그것이 이 판 전까지의 상태였다.
   */
  const instrument = await loadInstrumentSpec(today)
  const dayStart = new Date(`${today}T00:00:00+09:00`)
  const dayEnd = new Date(`${today}T23:59:59.999+09:00`)
  let folded: FoldResult = { open: null, closed: [] }
  let positionNote = 'position=none'
  try {
    folded = foldFills(await loadFills(contractCode, dayStart, dayEnd), instrument)
    positionNote = `position=${folded.open ? `${folded.open.direction}x${folded.open.quantity}` : 'flat'}`
      + `,closed=${folded.closed.length}`
  } catch (error) {
    positionNote = `position_failed:${error instanceof Error ? error.message : 'unknown'}`
  }

  /**
   * 손절가는 포지션을 연 **신호**에 있다. 신호를 못 찾으면 null 이고 사유를 남긴다 —
   * 0 을 쓰면 모든 가격이 손절가를 지난 것이 되어 매분 경고가 울린다.
   */
  let plan: SignalPlan | null = null
  if (folded.open?.signalId) {
    try {
      plan = await loadSignalPlan(folded.open.signalId)
      if (!plan) positionNote += ',plan=signal_not_found'
    } catch (error) {
      positionNote += `,plan_failed:${error instanceof Error ? error.message : 'unknown'}`
    }
  } else if (folded.open) {
    // 신호 없이 사람이 손으로 든 포지션. 손절가를 우리가 알 길이 없다
    positionNote += ',plan=manual_trade'
  }

  let protection: ProtectionRecord = { state: folded.open ? 'unknown' : 'none', reportedAt: null }
  try {
    protection = await loadProtection(contractCode)
  } catch (error) {
    positionNote += `,protection_failed:${error instanceof Error ? error.message : 'unknown'}`
  }

  if (account) {
    try {
      const watch = await runWatch({
        now,
        startedAt: now,
        contractCode,
        account,
        tradeDate: today,
        thresholds: {
          maxBrokerFailureStreak: num('gate_max_broker_failure_streak', 3),
          maxMinutesSinceRun: num('gate_max_minutes_since_run', 5),
          maxNotifyFailureStreak: num('gate_max_notify_failure_streak', 3),
          maxUnopenedSignals: num('gate_max_unopened_signals', 3),
        },
        expected: expectedFrom(contractCode, folded.open),
        positionState: folded.open ? 'holding' : 'flat',
        protection: protection.state,
        protectionReportedAt: protection.reportedAt,
        protectionRecheckMinutes: num('protection_recheck_minutes', 60),
        stopPrice: plan?.stopPrice ?? null,
        direction: folded.open?.direction ?? null,
        observedPrice,
        closedTrades: folded.closed,
        /**
         * 평가 손익은 **안 넣는다.** 한도가 보는 것은 실현이고(§8 D-32),
         * 평가를 섞으면 들고 있는 것이 오르내릴 때마다 새 신호가 멈췄다 풀렸다 한다.
         */
        unrealizedKrw: null,
        dailyTargetKrw: num('daily_target_krw', 0),
        brokerWasFailing: false,
        reconciledSinceRecovery: false,
        sameDayExitAt: sameDayExitAt(window, num('session_close_exit_minutes', 15)),
        gateContext: {
          barMissingOrLate: false,
          spreadAbnormal: false,
          brokerFailureStreak: 0,
          minutesSinceLastRun: 0,
          notifyFailureStreak: 0,
          hasCalibration: false,
          hasActiveSpec: false,
          marginTight: false,
          aiBudgetExhausted: false,
          marketAbnormal: false,
          logicChangedToday: syncReason.startsWith('logic_changed'),
        },
      })
      watchNote = watch.reason
    } catch (error) {
      watchNote = `watch_failed:${error instanceof Error ? error.message : 'unknown'}`
    }
  } else {
    watchNote = 'watch=no_account'
  }

  // 5 직전 1분 봉이 확정됐나
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
    return { ok: true, reason: `bar_not_ready|${fillNote}|${positionNote}|${watchNote}`, userMessage: null }
  }
  if (decision.kind === 'missing') {
    // 결측은 그 분의 판단을 건너뛰고 **사실을 남긴다**. 늦게 온 값으로 다시 판단하지 않는다
    return { ok: true, reason: `bar_missing:${target.toISOString()}|${fillNote}|${positionNote}|${watchNote}`, userMessage: null }
  }

  /**
   * 호가와 시세는 봉에 없어서 따로 받는다(명세 §6.1 이 최우선 호가와 미결제약정을 수집 항목에 넣는다).
   * **못 받아도 봉 저장은 안 막는다** — 모으는 일이 먼저고, 못 받은 사실은 사유로 남는다.
   */
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
    watchNote,
  ].filter(Boolean).join(',')

  /**
   * 야간장 봉은 여기까지다 — **모았고, 판단은 안 한다**(명세 §6.1).
   * 단일가 구간도 같다: 체결 방식이 다른 시장이라 그 봉으로 판단하면 다른 장을 보고 판단하는 것이다(D-40).
   */
  if (isNight) {
    return { ok: true, reason: `night_collected${collectNote ? `|${collectNote}` : ''}`, userMessage: null }
  }
  if (!isContinuousTrading(window, target)) {
    return { ok: true, reason: `not_continuous_trading${collectNote ? `|${collectNote}` : ''}`, userMessage: null }
  }

  // 6 진입 조건이 걸렸나
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

  // 7 선점한 판단기만 부른다
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

  /**
   * 8 판단에서 신호까지 — **정해진 순서로만**(M2).
   *
   * 지금은 보정 모델이 없어 대부분 「보정 없음」에서 멈춘다. 그래도 지나가게 해 둔다 —
   * 안 부르는 코드는 안 도는 코드이고, 보정이 생기는 날 「왜 안 나가지」를 여기서 찾게 된다.
   * 막힌 단계와 사유는 실행 기록에 남는다.
   */
  const emitNote = await emitOrExplain({
    now, today, window, target, contractCode, trigger, indicators,
    num, str, values, outcome, watchNote,
  })

  /**
   * 9 지식 작업 — **맨 뒤다** (§10.2).
   *
   * 앞의 것이 다 끝난 뒤에만, 남은 시간 안에서, 한 분에 하나만 한다.
   * 먼저 돌면 AI 가 느린 날 그 분의 수집과 판단이 통째로 밀리고, 밀린 봉은 다시 안 온다.
   */
  /**
   * 9 자동 주문 — **열린 포지션 위험 바로 다음**(§10.2), 곁가지보다 앞.
   *
   * 신호 발행 뒤에 둔다: 이번 분에 난 신호를 같은 분에 주문한다.
   * 무장이 안 됐으면 여기서 끝나고, 그것이 Release 1~3 과 같은 상태다.
   */
  const orderNote = await orderOrExplain({ now, today, str, num })

  const knowledgeNote = await knowledgeOrExplain({
    now, today, window, target, contractCode, num, str, indicators,
  })

  /**
   * 10 AI 운영자 — 지식과 같은 **맨 뒤**.
   *
   * 점검은 매분 하고 조치는 하나만 한다. 먼저 돌면 그 분의 수집과 판단이 밀린다.
   */
  const operatorNote = await operatorOrExplain({
    now, today, num, str, coverage: { expected: null, actual: null },
  })

  return {
    ok: true,
    reason: `${jevUnavailable ? `judged:jev_off(${jevUnavailable})` : 'judged'}|${fillNote}|${positionNote}|${watchNote}|${emitNote}|${orderNote}|${knowledgeNote}|${operatorNote}`,
    userMessage: null,
    ran: outcome.ran,
    skipped: outcome.skipped,
    deferred: outcome.deferred,
  }
}

/** 신호 발행 한 걸음. 실패해도 판단 기록은 이미 남았다 — 곁가지가 본 일을 죽이지 않는다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function emitOrExplain(ctx: any): Promise<string> {
  try {
    const { now, today, window, target, contractCode, trigger, indicators, num, str, outcome } = ctx
    const completed = outcome.results?.find?.(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r: any) => r.judge === 'rule' && r.result?.status === 'completed',
    )
    const rawScore = completed?.result?.rawScore ?? null
    const instrument = await loadInstrumentSpec(today)
    const barCloseAt = new Date(target.getTime() + 60_000)
    const result = await emitSignal({
      judgmentId: completed?.judgmentId ?? null,
      contractCode,
      barCloseAt,
      trigger,
      indicators,
      referencePrice: indicators.smaFast,
      instrument,
      // 보정 모델이 아직 없다. 없으면 확률이 아니므로 신호를 안 낸다(M3)
      calibratedProb: null,
      netExpectedValueR: null,
      holdDominant: rawScore ? isHoldDominant(rawScore) : true,
      enterNowProb: null,
      gateHits: [],
      thresholds: {
        minNetExpectedValueR: num('signal_min_net_ev_r', 0.1),
        minEnterNowProb: num('signal_min_enter_now_prob', 0.55),
        openingBlockMinutes: num('signal_opening_block_minutes', 5),
        closingBlockMinutes: num('signal_closing_block_minutes', 30),
        dailyTargetKrw: num('daily_target_krw', 0),
        cooldownAfterLosses: num('signal_cooldown_after_losses', 2),
        cooldownMinutes: num('signal_cooldown_minutes', 60),
        maxSignalsPerDay: num('signal_max_per_day', 6),
        sameDirectionGapMinutes: num('signal_same_direction_gap_minutes', 10),
        minTargetCostMultiple: num('signal_min_target_cost_multiple', 3),
      },
      rules: {
        minutesSinceOpen: Math.floor((target.getTime() - window.continuousStart.getTime()) / 60_000),
        minutesUntilClose: Math.floor((window.continuousEnd.getTime() - target.getTime()) / 60_000),
        rolloverOrExpiryDay: false,
        inEventBlackout: false,
        realizedPnlKrw: 0,
        remainingLossBudgetKrw: num('daily_loss_limit_krw', 0),
        consecutiveLosses: 0,
        minutesSinceLastLoss: null,
      },
      exit: {
        stopAtrMultiple: num('exit_stop_atr_multiple', 1.2),
        targetAtrMultiple: num('exit_target_atr_multiple', 1.5),
        chaseAtrMultiple: num('exit_chase_atr_multiple', 0.3),
        stopSlippageTicks: num('replay_fallback_ticks', 2),
        roundTripFeeKrw: num('fee_rate', 0),
        timeExitMinutes: num('min_hold_minutes', 15),
        sessionCloseAt: window.continuousEnd,
      },
      versions: {
        signalRules: str('decision_spec_version', 'v1'),
        calibration: null,
        evModel: null,
      },
      sessionDayStart: window.continuousStart,
      sessionDayEnd: window.continuousEnd,
      now,
    })
    return result.reason
  } catch (error) {
    return `emit_failed:${error instanceof Error ? error.message : 'unknown'}`
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

/** 지식 한 걸음. 실패해도 수집·판단·신호는 이미 끝났다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function knowledgeOrExplain(ctx: any): Promise<string> {
  try {
    const { now, today, window, target, num, str } = ctx
    const result = await runKnowledgeJob({
      now,
      startedAt: now,
      tradeDate: today,
      continuousTrading: isContinuousTrading(window, target),
      model: str('gemini_model', '') || null,
      // 1-C 는 체결 연결이 없어 우리가 쥔 포지션이 없다. 생기면 여기로 넘긴다
      position: null,
      reportFrom: seoulDaysAgo(today, num('pattern_window_days', 20)),
      reportMinSamples: num('pattern_min_samples', 30),
      reportMinBucketSamples: num('pattern_min_bucket', 5),
    })
    return result.reason
  } catch (error) {
    return `knowledge_failed:${error instanceof Error ? error.message : 'unknown'}`
  }
}

/** 서울 기준 며칠 전 */
function seoulDaysAgo(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00+09:00`)
  d.setUTCDate(d.getUTCDate() - Math.max(0, Math.round(days)))
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d)
}

/** 운영자 한 걸음. 실패해도 수집·판단·신호·지식은 이미 끝났다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function operatorOrExplain(ctx: any): Promise<string> {
  try {
    const { now, today } = ctx
    const result = await runOperatorJob({
      now,
      tradeDate: today,
      // 소유자는 설정에 있다. 없으면 넘길 곳이 없고 그 사실이 사유에 남는다
      ownerUserId: await readOwnerId(today),
      measurements: {
        /**
         * 1-C 는 아직 이 값들을 한자리에 모으지 않는다. **모르는 것은 null 로 넘긴다** —
         * 0 으로 넘기면 점검이 「괜찮다」로 읽고, 그것이 이 항목이 막으려는 바로 그 일이다.
         */
        expectedBars: null, actualBars: null,
        minutesSinceRun: null,
        brokerFailureStreak: null,
        notifyFailureStreak: null, pendingNotifications: null,
        hasCalibration: null,
        gatePassed: null, gateInsufficient: null,
        aiSpentKrw: null, aiBudgetKrw: null,
        reconciliationRequired: null,
      },
    })
    return result.reason
  } catch (error) {
    return `operator_failed:${error instanceof Error ? error.message : 'unknown'}`
  }
}

/** 소유자 ID. 없으면 사람에게 넘길 곳이 없다 */
async function readOwnerId(today: string): Promise<string | null> {
  const { values } = await loadTradingSettings(today)
  const owner = String(values.owner_user_id ?? '').trim()
  return owner === '' ? null : owner
}

/** 주문 한 걸음. 실패해도 수집·판단·신호는 이미 끝났다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function orderOrExplain(ctx: any): Promise<string> {
  try {
    const { now, today, str, num } = ctx
    const env = str('kis_env', 'real') as 'real' | 'paper'
    const result = await runOrderJob({
      now,
      env,
      session: isNightHour(now) ? 'night' : 'day',
      auth: { accessToken: '', appKey: '', appSecret: '' },
      /**
       * 계좌를 안 넘긴다. 무장이 안 된 지금은 `no_account` 로 끝나고,
       * 무장을 켜는 날 여기를 채운다 — **빈 인증으로 주문이 나가는 길을 안 만든다.**
       */
      acct: null,
      dayStart: new Date(`${today}T00:00:00+09:00`),
      dayEnd: new Date(`${today}T23:59:59+09:00`),
      maxOrdersPerDay: num('order_max_per_day', 12),
      maxOrderFailureStreak: num('order_max_failure_streak', 3),
      reconciliationRequired: false,
      protectionBreached: false,
      armCtx: {
        env,
        gatePassed: false, gateInsufficient: 0,
        notifyEnabled: false,
        paperAutoDays: 0, requiredPaperDays: num('order_required_paper_days', 20),
        reconciliationRequired: false,
        gateFailCount: 0,
        riskPerTradeKrw: 0, dailyLossLimitKrw: num('daily_loss_limit_krw', 0),
        paperExpectancyLowerR: null,
      },
      pendingEntry: null,
      openPosition: null,
      openOrderNos: [],
    })
    return result.reason
  } catch (error) {
    return `order_failed:${error instanceof Error ? error.message : 'unknown'}`
  }
}
