import 'server-only'

/**
 * 매분 감시 — 계획대로 돈다 (명세 §10.2)
 *
 * 무엇을 어떤 순서로 하는지는 `watch-plan.ts` 의 순수 함수가 정하고,
 * 여기는 그 순서대로 실제 일을 시킨다.
 *
 * **새 창구를 안 연다.** `cron/tick` 하나가 수집과 감시를 다 한다 —
 * 창구를 하나 더 열면 그 자리에도 같은 인증을 붙여야 하고, 붙이는 것을 잊으면 조용히 열린다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { RUN_BUDGET_MS } from './tick-core.ts'
import { planWithinBudget, watchReason, type WatchTask } from './watch-plan.ts'
import { watchTasks } from '../gate/safety.ts'
import { checkSafetyGates, newSignalAllowed, sortGateHits, type SafetyContext, type SafetyThresholds } from '../gate/safety.ts'
import type { AccountClient } from '../broker/account.ts'
import { brokerFailureStreak } from '../broker/account-request.ts'
import {
  reconcilePositions, lockReason, stateAfterReconcile, afterBrokerRecovery,
  type ExpectedPosition,
} from '../position/reconcile.ts'
import {
  detectBreach, shouldAskProtection, topAlert, nextState, needsHumanUnlock,
  canTransition, isSystemVerifiedProtection, DEFAULT_PROTECTION,
  type PositionState, type ProtectionState,
} from '../position/state.ts'
import { queueNotification, flushNotifications, recentNotifications } from '../notify/outbox.ts'
import { dailyDedupeKey, failureStreak, type NotifyKind } from '../notify/outbox-policy.ts'
import { dayPnl, pnlForLimits, type RealizedTrade } from '../position/pnl.ts'
import { unopenedSignalStreak } from '../signal/store.ts'

export interface WatchInput {
  now: Date
  startedAt: Date
  contractCode: string
  /**
   * 계좌 창구. **부르는 쪽이 만들어 넘긴다.**
   *
   * 여기서 만들면 체결 조회도 자기 것을 만들게 되고, 그러면 속도 제한 큐가 둘이 되어
   * KIS 제한을 두 배로 넘긴다. 큐는 창구마다가 아니라 **한 벌**이어야 한다.
   */
  account: AccountClient
  thresholds: SafetyThresholds
  /** 우리 기록의 포지션. 계좌와 다르면 계좌가 맞다 */
  expected: readonly ExpectedPosition[]
  positionState: PositionState
  protection: ProtectionState
  protectionReportedAt: Date | null
  protectionRecheckMinutes: number
  stopPrice: number | null
  direction: 'long' | 'short' | null
  /** 오늘 닫힌 거래. **실현 손익은 여기서만 나온다** — 평가와 안 섞인다 */
  closedTrades: readonly RealizedTrade[]
  /** 아직 안 닫은 포지션의 평가액. 한도 계산에 안 들어간다 */
  unrealizedKrw: number | null
  dailyTargetKrw: number
  /** 직전 실행에서 증권사 조회가 실패하고 있었나 (§10 복구 대조) */
  brokerWasFailing: boolean
  reconciledSinceRecovery: boolean
  /** 당일 청산 시각 */
  sameDayExitAt: Date
  /** 지금 본 값. 관측이지 체결이 아니다(D-32) */
  observedPrice: number | null
  /** 거래일 (`2026-09-25`). 신호 없는 알림의 유일 키에 들어간다 */
  tradeDate: string
  /** 게이트가 볼 나머지 값들 */
  gateContext: Omit<SafetyContext, 'hasPosition' | 'protectionState' | 'reconciliationRequired' | 'unopenedSignalStreak'>
}

export interface WatchResult {
  reason: string
  ran: WatchTask[]
  deferred: WatchTask[]
  /** 대기 표에 넣은 알림 수 */
  queued: number
  /** 이번에 보낸 알림 수 */
  sent: number
  /** 대조가 어긋나 잠갔나 */
  lockedReason: string | null
  /** 이번 분의 포지션 상태. 어긋나면 `reconciliation_required` 로 바뀐다 */
  positionState: PositionState
  /** 오늘 실현 손익(원). **한도와 목표가 보는 값** */
  realizedPnlKrw: number
}

/** 일 하나에 이만큼 걸린다고 본다. 넘으면 다음 실행으로 미룬다 */
const PER_TASK_MS = 4_000

export async function runWatch(input: WatchInput): Promise<WatchResult> {
  const account = input.account

  // 계좌를 먼저 본다 — 우리 기록이 맞는지는 계좌가 답한다
  const positions = await account.positions()
  const brokerOk = positions.ok
  const actual = positions.ok ? positions.value : []

  /**
   * 끊겼다 돌아왔으면 재개 전에 한 번 대조한다 (§10).
   * 바로 재개하면 끊긴 동안 열린 포지션을 못 본 채로 새 신호를 낸다.
   */
  const recovery = afterBrokerRecovery({
    wasFailing: input.brokerWasFailing,
    nowOk: brokerOk,
    reconciledSinceRecovery: input.reconciledSinceRecovery,
  })

  const outcome = positions.ok
    ? reconcilePositions(input.expected, actual)
    : ({ match: true } as const)
  const locked = lockReason(outcome)

  /**
   * 어긋났으면 상태를 옮긴다. **여기가 푸는 일은 절대 안 한다** —
   * `stateAfterReconcile` 은 `reconciliation_required` 아니면 null 만 돌려준다.
   */
  let positionState = input.positionState
  const nextByReconcile = stateAfterReconcile(positionState, outcome)
  if (nextByReconcile && canTransition(positionState, 'mismatch_found')) {
    positionState = nextState(positionState, 'mismatch_found')
  }

  const hasPosition = positions.ok ? actual.length > 0 : input.expected.length > 0

  /**
   * 목표 도달은 **실현 손익**으로만 본다 (§8 D-32).
   * 평가를 섞으면 들고 있는 것이 잠깐 오르내릴 때마다 새 신호가 멈췄다 풀렸다 한다.
   */
  const pnl = dayPnl(input.closedTrades, input.unrealizedKrw)
  const realizedPnlKrw = pnlForLimits(pnl)
  const profitTargetReached = input.dailyTargetKrw > 0 && realizedPnlKrw >= input.dailyTargetKrw

  const unopened = await unopenedSignalStreak(input.contractCode)
  const notifyFailures = failureStreak(await recentNotifications(20))
  const gateHits = checkSafetyGates({
    ...input.gateContext,
    notifyFailureStreak: notifyFailures,
    hasPosition,
    /**
     * **시스템이 보호됐다고 보는 값은 없다**(D-15 · D-47). 사람이 누른 것은 자기 입력이고,
     * 우리는 증권사 쪽에 손절이 걸렸는지 확인할 방법이 없다. 그래서 게이트에는
     * 있는 그대로 넘긴다 — 「보호됨」으로 바꿔 넘기면 SG-05 가 안 걸린다.
     */
    protectionState: isSystemVerifiedProtection(input.protection) ? 'none' : input.protection,
    reconciliationRequired: locked !== null,
    unopenedSignalStreak: unopened,
  }, input.thresholds)

  const tasks = watchTasks({
    hasPosition,
    profitTargetReached,
    gateBlocked: !newSignalAllowed(gateHits),
  })
  const plan = planWithinBudget({
    tasks,
    elapsedMs: input.now.getTime() - input.startedAt.getTime(),
    budgetMs: RUN_BUDGET_MS,
    perTaskMs: PER_TASK_MS,
  })

  let queued = 0
  /**
   * 신호 없는 알림도 대기 표를 지난다.
   *
   * 유일 키를 손으로 준다 — `signal_id` 가 NULL 이면 Postgres 에서 유일 키가
   * 아무것도 안 막고, 매분 도는 크론이 같은 경고를 하루 390번 넣는다(마이그 284).
   */
  const queue = async (kind: NotifyKind, title: string, body: string) => {
    const result = await queueNotification({
      signalId: null, kind, title, body,
      dedupeKey: dailyDedupeKey(input.contractCode, kind, input.tradeDate),
    })
    if (result.queued) queued += 1
  }

  for (const task of plan.run) {
    if (task === 'open_position_risk') {
      const breached = input.stopPrice !== null && input.direction !== null
        && input.observedPrice !== null && detectBreach({
        positionState: input.positionState,
        direction: input.direction,
        stopPrice: input.stopPrice,
        observedPrice: input.observedPrice ?? input.stopPrice,
      })
      if (breached) {
        await queue('protection_breached', '손절가를 지났습니다',
          '포지션이 남아 있습니다. 지금 확인해 주세요')
      }
      continue
    }
    if (task === 'protection') {
      const ask = shouldAskProtection({
        state: input.protection ?? DEFAULT_PROTECTION,
        reportedAt: input.protectionReportedAt,
        positionChangedSince: locked !== null,
        recheckMinutes: input.protectionRecheckMinutes,
      }, input.now)
      if (ask.ask) await queue('safety', '손절 확인', ask.userMessage)
      continue
    }
    if (task === 'daily_loss_limit' && gateHits.some((h) => h.id === 'SG-09')) {
      await queue('daily_limit', '증거금 경고', gateHits.find((h) => h.id === 'SG-09')?.userMessage ?? '')
      continue
    }
    if (task === 'session_close' && input.now.getTime() >= input.sameDayExitAt.getTime() && hasPosition) {
      await queue('session_close', '당일 청산 시각입니다', '오늘 안에 정리해 주세요')
      continue
    }
    if (task === 'profit_target' && profitTargetReached) {
      await queue('exit', '오늘 목표에 닿았습니다', '새 신호는 내일부터 나갑니다')
      continue
    }
  }

  // 알림 발송은 마지막이다. 앞의 판단이 실패해도 이미 쌓인 알림은 나가야 한다
  const flushed = await flushNotifications(input.now)

  if (locked) await lockPosition(input.contractCode, locked)

  const brokerNote = brokerOk ? '' : `,broker_failed:${brokerFailureStreak([{ ok: false }])}`
  const alert = topAlert({ position: positionState, protection: input.protection })
  return {
    reason: `${watchReason(plan)}${locked ? `,${locked}` : ''}${brokerNote}`
      + `${gateHits.length > 0 ? `,gates=${sortGateHits(gateHits).map((h) => h.id).join('+')}` : ''}`
      + `${recovery.action === 'reconcile_once' ? ',recovered' : ''}`
      + `${needsHumanUnlock(positionState) ? ',locked_until_human' : ''}`
      + `${alert ? `,top=${alert}` : ''}`,
    ran: plan.run,
    deferred: plan.deferred,
    queued,
    sent: flushed.sent,
    lockedReason: locked,
    positionState,
    realizedPnlKrw,
  }
}

/**
 * 어긋남을 기록으로 남긴다. **푸는 것은 여기가 안 한다** —
 * `resolved_by` 는 사람이 화면에서 확인할 때만 찬다(§11).
 */
async function lockPosition(contractCode: string, reason: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_position_events').insert({
    contract_code: contractCode,
    position_state: 'reconciliation_required',
    protection_state: 'unknown',
    reason,
  })
  if (error) throw new Error(`대조 잠금을 적지 못했습니다: ${error.message}`)
}
