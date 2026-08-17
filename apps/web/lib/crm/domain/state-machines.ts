/**
 * 상태 전이 판정 SSOT (구현명세서 3.4, CLAUDE_dacrm 절대규칙 5)
 *
 *   "상태 전이는 state-machines.ts 의 canTransit 를 통해서만 판정한다.
 *    서비스나 라우트에서 직접 status 를 대입하지 않는다"
 *
 * 판정이 한 곳에 있어야 하는 이유는 전이표가 복잡해서가 아니다.
 * 전이 조건이 **데이터 정합성 그 자체**이기 때문이다 —
 * "WON 인데 금액이 없다"는 상태가 만들어지는 순간 파이프라인 합계가 조용히 틀린다.
 * DB 의 CHECK(chk_won, chk_lost)가 마지막 그물이고, 여기가 첫 번째 그물이다.
 */

import { CrmError } from './errors.ts'

// ------------------------------------------------------------
// 공통
// ------------------------------------------------------------

export interface TransitVerdict {
  ok: boolean
  /** 거부 사유 코드. 사용자 문장이 아니라 로그·테스트용 식별자다. */
  reason?:
    | 'SAME_STATE'
    | 'NOT_ALLOWED'
    | 'MISSING_WON_FIELDS'
    | 'MISSING_LOST_REASON'
    | 'MISSING_REOPEN_REASON'
    | 'RETRY_EXHAUSTED'
    | 'TERMINAL_STATE'
    | 'EXPIRED'
    | 'EMPTY_QUOTE'
    | 'NEEDS_APPROVAL'
}

const OK: TransitVerdict = { ok: true }
const no = (reason: NonNullable<TransitVerdict['reason']>): TransitVerdict => ({ ok: false, reason })

// ------------------------------------------------------------
// 딜 (명세 3.4)
//   OPEN → WON(wonAt, amountMinor 필수) | LOST(lostReason 필수)
//   WON → OPEN, LOST → OPEN (재오픈, 사유 기록)
//   WON → LOST 직접 전이 금지
// ------------------------------------------------------------

export type DealStatus = 'OPEN' | 'WON' | 'LOST'

export interface DealTransitCtx {
  wonAt?: Date | string | null
  amountMinor?: bigint | number | null
  lostReason?: string | null
  /** 재오픈 사유. WON/LOST → OPEN 에 필수(명세 3.4 "재오픈, 사유 기록") */
  reopenReason?: string | null
}

export function canTransitDeal(
  from: DealStatus,
  to: DealStatus,
  ctx: DealTransitCtx = {},
): TransitVerdict {
  if (from === to) return no('SAME_STATE')

  if (from === 'OPEN' && to === 'WON') {
    const hasWonAt = ctx.wonAt !== undefined && ctx.wonAt !== null
    const hasAmount = ctx.amountMinor !== undefined && ctx.amountMinor !== null
    return hasWonAt && hasAmount ? OK : no('MISSING_WON_FIELDS')
  }

  if (from === 'OPEN' && to === 'LOST') {
    const reason = (ctx.lostReason ?? '').trim()
    return reason.length > 0 ? OK : no('MISSING_LOST_REASON')
  }

  if (to === 'OPEN' && (from === 'WON' || from === 'LOST')) {
    const reason = (ctx.reopenReason ?? '').trim()
    return reason.length > 0 ? OK : no('MISSING_REOPEN_REASON')
  }

  // WON → LOST 는 명세가 명시적으로 금지한다.
  // LOST → WON 은 명세에 없다. 금지로 둔다 — 실주를 성사로 바로 뒤집으면
  // 실주 사유가 남은 채 WON 이 되어 리포트가 두 번 세어진다. 재오픈을 거치게 한다.
  return no('NOT_ALLOWED')
}

// ------------------------------------------------------------
// 녹음 (명세 3.4 / 3.2)
//   UPLOADED → TRANSCRIBING → TRANSCRIBED → SUMMARIZED
//   각 단계 실패 → FAILED, 3회까지 재시도
// ------------------------------------------------------------

export type RecordingStatus =
  | 'UPLOADED' | 'TRANSCRIBING' | 'TRANSCRIBED' | 'SUMMARIZED' | 'FAILED'

/** 명세 3.2 "retryCount 증가, 3회 초과면 FAILED" */
export const RECORDING_MAX_RETRY = 3

export interface RecordingTransitCtx {
  retryCount?: number
}

const RECORDING_FORWARD: Record<RecordingStatus, RecordingStatus | null> = {
  UPLOADED: 'TRANSCRIBING',
  TRANSCRIBING: 'TRANSCRIBED',
  TRANSCRIBED: 'SUMMARIZED',
  SUMMARIZED: null,
  FAILED: null,
}

export function canTransitRecording(
  from: RecordingStatus,
  to: RecordingStatus,
  ctx: RecordingTransitCtx = {},
): TransitVerdict {
  if (from === to) return no('SAME_STATE')

  // 어느 단계에서든 실패할 수 있다. 단 종료 상태에서는 아니다.
  if (to === 'FAILED') {
    return from === 'SUMMARIZED' ? no('TERMINAL_STATE') : OK
  }

  // 실패 후 재시도는 전사부터 다시 한다.
  if (from === 'FAILED') {
    if (to !== 'TRANSCRIBING') return no('NOT_ALLOWED')
    const used = ctx.retryCount ?? 0
    return used < RECORDING_MAX_RETRY ? OK : no('RETRY_EXHAUSTED')
  }

  // 정상 진행은 한 칸씩만. 건너뛰기도 되돌아가기도 안 된다.
  return RECORDING_FORWARD[from] === to ? OK : no('NOT_ALLOWED')
}

// ------------------------------------------------------------
// 제안 (명세 3.4 / 3.3)
//   PENDING → ACCEPTED | REJECTED | EXPIRED(7일) | AUTO_APPLIED
// ------------------------------------------------------------

export type SuggestionStatus =
  | 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'AUTO_APPLIED'

/** 명세 4.3 / CrmAiSuggestion.expiresAt = 생성 + 7일 */
export const SUGGESTION_TTL_DAYS = 7

export interface SuggestionTransitCtx {
  expiresAt?: Date | string | null
  now?: Date
}

function isExpired(ctx: SuggestionTransitCtx): boolean {
  if (!ctx.expiresAt) return false
  const exp = ctx.expiresAt instanceof Date ? ctx.expiresAt : new Date(ctx.expiresAt)
  return (ctx.now ?? new Date()).getTime() >= exp.getTime()
}

export function canTransitSuggestion(
  from: SuggestionStatus,
  to: SuggestionStatus,
  ctx: SuggestionTransitCtx = {},
): TransitVerdict {
  if (from === to) return no('SAME_STATE')
  if (from !== 'PENDING') return no('TERMINAL_STATE')

  // 만료 처리는 만료 시각이 지나야 한다.
  if (to === 'EXPIRED') return isExpired(ctx) ? OK : no('NOT_ALLOWED')

  // 사람이 결정하는 전이(수락·거절)와 자동 반영은 만료 전에만 가능하다(명세 3.3-1).
  if (to === 'ACCEPTED' || to === 'REJECTED' || to === 'AUTO_APPLIED') {
    return isExpired(ctx) ? no('EXPIRED') : OK
  }

  return no('NOT_ALLOWED')
}

// ------------------------------------------------------------
// 견적
//   DRAFT → SENT (항목이 있어야 하고, 할인이 임계를 넘으면 승인이 있어야 한다)
//   SENT → ACCEPTED | REJECTED | EXPIRED
//   EXPIRED → DRAFT (기간이 지난 견적은 고쳐서 다시 보낸다)
//   ACCEPTED · REJECTED 는 종료 — 뒤집으려면 새 견적을 만든다
//
// 왜 되돌리기를 막나: 이미 보낸 문서가 고객 손에 있다.
// 그 문서를 조용히 바꾸면 우리 화면과 고객이 든 종이가 서로 다른 말을 한다.
// ------------------------------------------------------------

export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED'

export interface QuoteTransitCtx {
  /** 견적 항목 수 — 빈 견적을 보낼 수는 없다 */
  lineCount?: number
  /** 할인이 임계를 넘어 승인이 필요한가 */
  approvalRequired?: boolean
  /** 승인된 시각. 필요한데 없으면 보낼 수 없다 */
  approvedAt?: Date | string | null
  /** 유효기간. 만료 처리는 이 시각이 지나야 한다 */
  validUntil?: Date | string | null
  now?: Date
}

export function canTransitQuote(
  from: QuoteStatus,
  to: QuoteStatus,
  ctx: QuoteTransitCtx = {},
): TransitVerdict {
  if (from === to) return no('SAME_STATE')

  if (from === 'DRAFT' && to === 'SENT') {
    if ((ctx.lineCount ?? 0) <= 0) return no('EMPTY_QUOTE')
    if (ctx.approvalRequired && !ctx.approvedAt) return no('NEEDS_APPROVAL')
    return OK
  }

  if (from === 'SENT') {
    if (to === 'ACCEPTED' || to === 'REJECTED') return OK
    if (to === 'EXPIRED') {
      // 기간이 안 지났는데 만료로 두면 살아 있는 견적이 사라진다
      if (!ctx.validUntil) return no('NOT_ALLOWED')
      const exp = ctx.validUntil instanceof Date ? ctx.validUntil : new Date(ctx.validUntil)
      return (ctx.now ?? new Date()).getTime() >= exp.getTime() ? OK : no('NOT_ALLOWED')
    }
    return no('NOT_ALLOWED')
  }

  // 만료된 견적은 초안으로 되돌려 고칠 수 있다 — 새로 다 쓰게 하지 않는다
  if (from === 'EXPIRED' && to === 'DRAFT') return OK

  if (from === 'ACCEPTED' || from === 'REJECTED') return no('TERMINAL_STATE')

  return no('NOT_ALLOWED')
}

// ------------------------------------------------------------
// 예산 (명세 3.4 / 3.6) — 전이가 아니라 판정이다
//   spent < limit 정상 / >= 80% 경보 1회 / >= 100% 소프트 차단 / 상한 상향 시 즉시 해제
// ------------------------------------------------------------

export const BUDGET_ALERT_RATIO = 0.8

export interface BudgetState {
  limitMinorUsd: bigint | number
  spentMinorUsd: bigint | number
  alertSentAt?: Date | string | null
  blockedAt?: Date | string | null
}

export interface BudgetVerdict {
  level: 'ok' | 'warn' | 'blocked'
  /** 이번에 경보를 보내야 하는가 (80% 도달 + 아직 안 보냄) */
  shouldSendAlert: boolean
  /** 이번에 차단 상태로 바꿔야 하는가 */
  shouldBlock: boolean
  /** 이번에 차단을 풀어야 하는가 (상한 상향 등으로 100% 아래로 내려옴) */
  shouldUnblock: boolean
  /** 0.0 ~ (1 초과 가능) */
  ratio: number
}

export function evaluateBudget(state: BudgetState): BudgetVerdict {
  const limit = Number(state.limitMinorUsd)
  const spent = Number(state.spentMinorUsd)

  // 상한이 0 이하면 비율을 계산할 수 없다. 0 은 "AI 를 쓰지 않겠다"는 뜻으로 본다.
  const ratio = limit > 0 ? spent / limit : (spent > 0 ? Infinity : 0)
  const isBlocked = Boolean(state.blockedAt)
  const alerted = Boolean(state.alertSentAt)

  const overLimit = limit > 0 ? spent >= limit : spent > 0
  const overAlert = limit > 0 && spent >= limit * BUDGET_ALERT_RATIO

  if (overLimit) {
    return {
      level: 'blocked',
      shouldSendAlert: !alerted, // 80% 를 건너뛰고 바로 100% 를 넘길 수도 있다
      shouldBlock: !isBlocked,
      shouldUnblock: false,
      ratio,
    }
  }

  return {
    level: overAlert ? 'warn' : 'ok',
    shouldSendAlert: overAlert && !alerted,
    shouldBlock: false,
    // 상한을 올리면 차단이 즉시 풀려야 한다(명세 3.6-4)
    shouldUnblock: isBlocked,
    ratio,
  }
}

// ------------------------------------------------------------
// 서비스 계층이 쓰는 진입점
// ------------------------------------------------------------

export type TransitKind = 'deal' | 'recording' | 'suggestion' | 'quote'

/**
 * 명세 3.4 의 단일 진입점. true 일 때만 진행하고, false 면 422 INVALID_TRANSITION.
 */
export function canTransit(
  kind: TransitKind,
  from: string,
  to: string,
  ctx: DealTransitCtx & RecordingTransitCtx & SuggestionTransitCtx & QuoteTransitCtx = {},
): TransitVerdict {
  switch (kind) {
    case 'deal':
      return canTransitDeal(from as DealStatus, to as DealStatus, ctx)
    case 'recording':
      return canTransitRecording(from as RecordingStatus, to as RecordingStatus, ctx)
    case 'suggestion':
      return canTransitSuggestion(from as SuggestionStatus, to as SuggestionStatus, ctx)
    case 'quote':
      return canTransitQuote(from as QuoteStatus, to as QuoteStatus, ctx)
    default:
      // 새 종류를 추가하고 여기를 빼먹으면 조용히 통과시키지 않는다.
      return no('NOT_ALLOWED')
  }
}

/** 사용자 노출 문장 — 거부 사유별로 무엇이 부족한지 알려준다 */
const REASON_MESSAGE: Record<NonNullable<TransitVerdict['reason']>, string> = {
  SAME_STATE: '이미 같은 상태입니다.',
  NOT_ALLOWED: '지금 상태에서는 할 수 없는 변경입니다.',
  MISSING_WON_FIELDS: '성사로 바꾸려면 성사일과 금액이 필요합니다.',
  MISSING_LOST_REASON: '실주로 바꾸려면 사유가 필요합니다.',
  MISSING_REOPEN_REASON: '다시 열려면 사유가 필요합니다.',
  RETRY_EXHAUSTED: '재시도 횟수를 모두 사용했습니다.',
  TERMINAL_STATE: '이미 종료된 항목은 상태를 바꿀 수 없습니다.',
  EXPIRED: '기한이 지난 제안입니다.',
  EMPTY_QUOTE: '항목이 없는 견적은 보낼 수 없습니다. 먼저 항목을 추가해 주세요.',
  NEEDS_APPROVAL: '할인율이 승인 기준을 넘었습니다. 승인을 받은 뒤 보낼 수 있습니다.',
}

/** 판정이 false 면 CrmError(INVALID_TRANSITION, 422)를 던진다 */
export function assertTransit(
  kind: TransitKind,
  from: string,
  to: string,
  ctx: DealTransitCtx & RecordingTransitCtx & SuggestionTransitCtx & QuoteTransitCtx = {},
): void {
  const verdict = canTransit(kind, from, to, ctx)
  if (verdict.ok) return
  const reason = verdict.reason ?? 'NOT_ALLOWED'
  throw new CrmError('INVALID_TRANSITION', REASON_MESSAGE[reason], { kind, from, to, reason })
}
