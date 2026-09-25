/**
 * 체결 대조 — **진실은 계좌다** (§10 SG-04)
 *
 * ## 왜 계좌를 따르나
 *
 * 우리 기록은 「사람이 신호대로 했다면 이랬을 것」이고, 계좌는 「실제로 이랬다」이다.
 * 사람은 신호를 건너뛰기도 하고, 수량을 다르게 넣기도 하고, 우리가 모르는 거래를 하기도 한다.
 * 그럴 때 우리 기록을 맞다고 보면 **있지도 않은 포지션의 손절을 감시하게 된다.**
 *
 * ## 왜 코드가 못 푸나
 *
 * 어긋남을 코드가 스스로 풀면, 푸는 규칙이 틀렸을 때 틀린 채로 계속 간다.
 * 어긋남은 드물고 원인이 매번 다르다 — 사람이 보고 확인해야 한다(§11).
 * 그래서 이 모듈은 **잠그기만 하고 절대 안 푼다.** 푸는 것은 화면의 사람 확인뿐이다.
 */

import type { PositionState } from './state.ts'

/** 우리가 기록해 둔 포지션 */
export interface ExpectedPosition {
  contractCode: string
  direction: 'long' | 'short'
  quantity: number
}

/** 계좌에서 본 포지션 */
export interface ActualPosition {
  contractCode: string
  direction: 'long' | 'short' | null
  quantity: number
}

export const MISMATCH_KINDS = [
  /** 우리는 있다는데 계좌엔 없다 */
  'missing_in_account',
  /** 계좌엔 있는데 우리 기록엔 없다 (사람이 우리 모르게 거래했다) */
  'unknown_in_account',
  'direction_differs',
  'quantity_differs',
  /** 계좌가 방향을 안 준다 — 모르는 것을 맞다고 볼 수 없다 */
  'direction_unknown',
] as const
export type MismatchKind = (typeof MISMATCH_KINDS)[number]

export interface Mismatch {
  kind: MismatchKind
  contractCode: string
  expected: string
  actual: string
  userMessage: string
}

export type ReconcileOutcome =
  | { match: true }
  /** **어긋난 것 전부**를 돌려준다. 하나만 주면 고치고 다시 걸리고를 반복한다 */
  | { match: false; mismatches: Mismatch[] }

function describe(p: { direction: 'long' | 'short' | null; quantity: number } | null): string {
  if (!p) return '없음'
  const dir = p.direction === 'long' ? '매수' : p.direction === 'short' ? '매도' : '방향 모름'
  return `${dir} ${p.quantity}장`
}

/**
 * 우리 기록과 계좌를 맞춰 본다.
 *
 * 종목코드로 짝을 짓는다. 어느 쪽에만 있는 것도 어긋남이다 —
 * 계좌에만 있는 것을 무시하면 사람이 우리 모르게 연 포지션을 아무도 안 본다.
 */
export function reconcilePositions(
  expected: readonly ExpectedPosition[],
  actual: readonly ActualPosition[],
): ReconcileOutcome {
  const mismatches: Mismatch[] = []
  const actualBy = new Map(actual.map((a) => [a.contractCode, a]))
  const expectedBy = new Map(expected.map((e) => [e.contractCode, e]))

  for (const e of expected) {
    const a = actualBy.get(e.contractCode)
    if (!a) {
      mismatches.push({
        kind: 'missing_in_account', contractCode: e.contractCode,
        expected: describe(e), actual: '없음',
        userMessage: `${e.contractCode} 포지션이 기록에는 있는데 계좌에 없습니다`,
      })
      continue
    }
    if (a.direction === null) {
      mismatches.push({
        kind: 'direction_unknown', contractCode: e.contractCode,
        expected: describe(e), actual: describe(a),
        userMessage: `${e.contractCode} 의 매수·매도를 계좌 응답에서 읽지 못했습니다`,
      })
      continue
    }
    if (a.direction !== e.direction) {
      mismatches.push({
        kind: 'direction_differs', contractCode: e.contractCode,
        expected: describe(e), actual: describe(a),
        userMessage: `${e.contractCode} 의 방향이 기록과 다릅니다`,
      })
    }
    if (a.quantity !== e.quantity) {
      mismatches.push({
        kind: 'quantity_differs', contractCode: e.contractCode,
        expected: describe(e), actual: describe(a),
        userMessage: `${e.contractCode} 의 수량이 기록과 다릅니다`,
      })
    }
  }

  for (const a of actual) {
    if (expectedBy.has(a.contractCode)) continue
    mismatches.push({
      kind: 'unknown_in_account', contractCode: a.contractCode,
      expected: '없음', actual: describe(a),
      userMessage: `${a.contractCode} 포지션이 계좌에 있는데 기록에 없습니다`,
    })
  }

  return mismatches.length === 0 ? { match: true } : { match: false, mismatches }
}

/**
 * 대조 결과를 어떤 상태로 옮기나.
 *
 * **여기서 나오는 값은 `reconciliation_required` 아니면 「그대로」뿐이다.**
 * 이 함수가 `flat` 이나 `holding` 을 돌려주는 순간 코드가 스스로 푸는 길이 열린다.
 *
 * 지금 상태를 안 본다. 수량이 달라도 방향이 달라도 계좌에만 있어도 **같은 자리로 간다** —
 * 어긋남의 종류마다 다르게 처리하면 그 분기 하나하나가 「코드가 판단한 것」이 된다.
 */
export function stateAfterReconcile(
  _current: PositionState, outcome: ReconcileOutcome,
): PositionState | null {
  if (outcome.match) return null
  return 'reconciliation_required'
}

/** 잠금 사유 한 줄. 무엇이 몇 건 어긋났는지가 들어간다 */
export function lockReason(outcome: ReconcileOutcome): string | null {
  if (outcome.match) return null
  const kinds = outcome.mismatches.map((m) => `${m.kind}@${m.contractCode}`)
  return `SG-04:${kinds.join(',')}`.slice(0, 300)
}

// ── 조회 실패에서 복구했을 때 (§10) ───────────────────────

export interface RecoveryInput {
  /** 직전에 조회가 연속 실패했나 */
  wasFailing: boolean
  /** 이번 조회가 됐나 */
  nowOk: boolean
  /** 실패가 풀린 뒤 대조를 이미 한 번 했나 */
  reconciledSinceRecovery: boolean
}

export type RecoveryAction =
  | { action: 'reconcile_once'; reason: 'recovered_from_failure' }
  | { action: 'continue' }
  | { action: 'stay_blocked'; reason: 'still_failing' }

/**
 * 조회가 끊겼다 돌아왔을 때 무엇을 하나 (§10).
 *
 * 끊긴 동안 사람이 무엇을 했는지 모른다. 그래서 **재개 전에 한 번 대조한다.**
 * 바로 재개하면 끊긴 동안 열린 포지션을 못 본 채로 새 신호를 낸다.
 */
export function afterBrokerRecovery(input: RecoveryInput): RecoveryAction {
  if (!input.nowOk) return { action: 'stay_blocked', reason: 'still_failing' }
  if (input.wasFailing && !input.reconciledSinceRecovery) {
    return { action: 'reconcile_once', reason: 'recovered_from_failure' }
  }
  return { action: 'continue' }
}
