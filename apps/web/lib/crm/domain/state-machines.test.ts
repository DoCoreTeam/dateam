import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canTransit, assertTransit,
  canTransitDeal, canTransitRecording, canTransitSuggestion, canTransitQuote,
  evaluateBudget, RECORDING_MAX_RETRY, BUDGET_ALERT_RATIO,
  type DealStatus, type RecordingStatus, type SuggestionStatus,
} from './state-machines.ts'
import { CrmError } from './errors.ts'

/**
 * 완료 기준: "3.4 전이표 전 케이스(허용, 금지) 통과"
 * → from × to 전 조합을 표로 적고 하나도 빠짐없이 대조한다.
 *   조합을 빠뜨리면 "금지인 줄 알았는데 통과하는" 전이가 조용히 생긴다.
 */

// ------------------------------------------------------------
// 딜 — 3×3 = 9 조합 전수
// ------------------------------------------------------------

const DEAL_STATES: DealStatus[] = ['OPEN', 'WON', 'LOST']

/** 조건을 모두 충족시킨 상태에서 허용되는 조합만 true */
const DEAL_ALLOWED: Record<string, boolean> = {
  'OPEN>OPEN': false, 'OPEN>WON': true,  'OPEN>LOST': true,
  'WON>OPEN':  true,  'WON>WON':  false, 'WON>LOST':  false, // WON→LOST 직접 전이 금지(명세 3.4)
  'LOST>OPEN': true,  'LOST>WON': false, 'LOST>LOST': false, // LOST→WON 도 재오픈을 거쳐야 한다
}

const DEAL_FULL_CTX = {
  wonAt: new Date('2026-08-16T00:00:00Z'),
  amountMinor: 300000000,
  lostReason: '가격 경쟁력 부족',
  reopenReason: '고객이 재검토 요청',
}

test('딜 전이표 9조합 전수 — 조건 충족 시', () => {
  for (const from of DEAL_STATES) {
    for (const to of DEAL_STATES) {
      const key = `${from}>${to}`
      const got = canTransitDeal(from, to, DEAL_FULL_CTX).ok
      assert.equal(got, DEAL_ALLOWED[key], `${key} 기대 ${DEAL_ALLOWED[key]} / 실제 ${got}`)
    }
  }
})

test('딜 전이표 9조합 전수 — 조건 없이(빈 ctx)는 조건부 전이가 전부 막힌다', () => {
  for (const from of DEAL_STATES) {
    for (const to of DEAL_STATES) {
      assert.equal(canTransitDeal(from, to, {}).ok, false, `${from}>${to} 가 조건 없이 통과했다`)
    }
  }
})

test('OPEN→WON 은 성사일과 금액이 둘 다 있어야 한다', () => {
  assert.equal(canTransitDeal('OPEN', 'WON', { wonAt: new Date() }).reason, 'MISSING_WON_FIELDS')
  assert.equal(canTransitDeal('OPEN', 'WON', { amountMinor: 100 }).reason, 'MISSING_WON_FIELDS')
  assert.equal(canTransitDeal('OPEN', 'WON', { wonAt: new Date(), amountMinor: 0 }).ok, true,
    '금액 0 은 "없음"이 아니라 "0원"이다 — 통과해야 한다')
  assert.equal(canTransitDeal('OPEN', 'WON', { wonAt: new Date(), amountMinor: null }).ok, false)
})

test('OPEN→LOST 는 사유가 공백만이면 거부한다', () => {
  assert.equal(canTransitDeal('OPEN', 'LOST', { lostReason: '   ' }).reason, 'MISSING_LOST_REASON')
  assert.equal(canTransitDeal('OPEN', 'LOST', { lostReason: '예산 미확보' }).ok, true)
})

test('재오픈은 사유가 필요하다 (명세 3.4 "재오픈, 사유 기록")', () => {
  assert.equal(canTransitDeal('WON', 'OPEN', {}).reason, 'MISSING_REOPEN_REASON')
  assert.equal(canTransitDeal('LOST', 'OPEN', { reopenReason: '재입찰' }).ok, true)
})

test('같은 상태로의 전이는 SAME_STATE 로 구분된다', () => {
  assert.equal(canTransitDeal('OPEN', 'OPEN', DEAL_FULL_CTX).reason, 'SAME_STATE')
})

// ------------------------------------------------------------
// 녹음 — 5×5 = 25 조합 전수
// ------------------------------------------------------------

const REC_STATES: RecordingStatus[] = ['UPLOADED', 'TRANSCRIBING', 'TRANSCRIBED', 'SUMMARIZED', 'FAILED']

const REC_ALLOWED: Record<string, boolean> = {
  'UPLOADED>UPLOADED': false, 'UPLOADED>TRANSCRIBING': true, 'UPLOADED>TRANSCRIBED': false,
  'UPLOADED>SUMMARIZED': false, 'UPLOADED>FAILED': true,

  'TRANSCRIBING>UPLOADED': false, 'TRANSCRIBING>TRANSCRIBING': false, 'TRANSCRIBING>TRANSCRIBED': true,
  'TRANSCRIBING>SUMMARIZED': false, 'TRANSCRIBING>FAILED': true,

  'TRANSCRIBED>UPLOADED': false, 'TRANSCRIBED>TRANSCRIBING': false, 'TRANSCRIBED>TRANSCRIBED': false,
  'TRANSCRIBED>SUMMARIZED': true, 'TRANSCRIBED>FAILED': true,

  'SUMMARIZED>UPLOADED': false, 'SUMMARIZED>TRANSCRIBING': false, 'SUMMARIZED>TRANSCRIBED': false,
  'SUMMARIZED>SUMMARIZED': false, 'SUMMARIZED>FAILED': false, // 끝난 것은 실패로도 못 간다

  'FAILED>UPLOADED': false, 'FAILED>TRANSCRIBING': true, 'FAILED>TRANSCRIBED': false,
  'FAILED>SUMMARIZED': false, 'FAILED>FAILED': false,
}

test('녹음 전이표 25조합 전수 — 재시도 여유가 있을 때', () => {
  for (const from of REC_STATES) {
    for (const to of REC_STATES) {
      const key = `${from}>${to}`
      const got = canTransitRecording(from, to, { retryCount: 0 }).ok
      assert.equal(got, REC_ALLOWED[key], `${key} 기대 ${REC_ALLOWED[key]} / 실제 ${got}`)
    }
  }
})

test('단계 건너뛰기는 전부 막힌다', () => {
  assert.equal(canTransitRecording('UPLOADED', 'TRANSCRIBED').reason, 'NOT_ALLOWED')
  assert.equal(canTransitRecording('UPLOADED', 'SUMMARIZED').reason, 'NOT_ALLOWED')
  assert.equal(canTransitRecording('TRANSCRIBING', 'SUMMARIZED').reason, 'NOT_ALLOWED')
})

test(`재시도는 ${RECORDING_MAX_RETRY}회까지만`, () => {
  for (let n = 0; n < RECORDING_MAX_RETRY; n++) {
    assert.equal(canTransitRecording('FAILED', 'TRANSCRIBING', { retryCount: n }).ok, true, `${n}회차`)
  }
  assert.equal(
    canTransitRecording('FAILED', 'TRANSCRIBING', { retryCount: RECORDING_MAX_RETRY }).reason,
    'RETRY_EXHAUSTED',
  )
})

test('retryCount 를 안 주면 0 으로 본다 (조용히 무한 재시도되지 않도록 명시)', () => {
  assert.equal(canTransitRecording('FAILED', 'TRANSCRIBING').ok, true)
})

// ------------------------------------------------------------
// 제안 — 5×5 = 25 조합 전수
// ------------------------------------------------------------

const SUG_STATES: SuggestionStatus[] = ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'AUTO_APPLIED']

const NOW = new Date('2026-08-16T00:00:00Z')
const NOT_YET = { expiresAt: new Date('2026-08-20T00:00:00Z'), now: NOW }
const ALREADY = { expiresAt: new Date('2026-08-10T00:00:00Z'), now: NOW }

/** 만료 전 기준 */
const SUG_ALLOWED_BEFORE_EXPIRY: Record<string, boolean> = {
  'PENDING>PENDING': false, 'PENDING>ACCEPTED': true, 'PENDING>REJECTED': true,
  'PENDING>EXPIRED': false, // 아직 기한이 안 지났다
  'PENDING>AUTO_APPLIED': true,
  ...Object.fromEntries(
    SUG_STATES.filter((s) => s !== 'PENDING').flatMap((from) =>
      SUG_STATES.map((to) => [`${from}>${to}`, false]),
    ),
  ),
}

test('제안 전이표 25조합 전수 — 만료 전', () => {
  for (const from of SUG_STATES) {
    for (const to of SUG_STATES) {
      const key = `${from}>${to}`
      const got = canTransitSuggestion(from, to, NOT_YET).ok
      assert.equal(got, SUG_ALLOWED_BEFORE_EXPIRY[key], `${key} 기대 ${SUG_ALLOWED_BEFORE_EXPIRY[key]} / 실제 ${got}`)
    }
  }
})

test('제안 전이표 25조합 전수 — 만료 후에는 EXPIRED 만 허용', () => {
  for (const from of SUG_STATES) {
    for (const to of SUG_STATES) {
      const expected = from === 'PENDING' && to === 'EXPIRED'
      assert.equal(canTransitSuggestion(from, to, ALREADY).ok, expected, `${from}>${to}`)
    }
  }
})

test('만료된 제안을 수락하려 하면 EXPIRED 사유로 거부한다 (명세 3.3-1)', () => {
  assert.equal(canTransitSuggestion('PENDING', 'ACCEPTED', ALREADY).reason, 'EXPIRED')
  assert.equal(canTransitSuggestion('PENDING', 'AUTO_APPLIED', ALREADY).reason, 'EXPIRED')
})

test('종료 상태에서 나가는 전이는 전부 TERMINAL_STATE', () => {
  for (const from of ['ACCEPTED', 'REJECTED', 'EXPIRED', 'AUTO_APPLIED'] as SuggestionStatus[]) {
    assert.equal(canTransitSuggestion(from, 'PENDING', NOT_YET).reason, 'TERMINAL_STATE')
  }
})

test('expiresAt 이 없으면 만료로 보지 않는다', () => {
  assert.equal(canTransitSuggestion('PENDING', 'ACCEPTED', { now: NOW }).ok, true)
})

// ------------------------------------------------------------
// 예산 (명세 3.4 / 3.6)
// ------------------------------------------------------------

test('상한 미만이면 정상', () => {
  const v = evaluateBudget({ limitMinorUsd: 10000, spentMinorUsd: 1000 })
  assert.equal(v.level, 'ok')
  assert.equal(v.shouldSendAlert, false)
  assert.equal(v.shouldBlock, false)
})

test(`${BUDGET_ALERT_RATIO * 100}% 도달 시 경보, 단 1회만`, () => {
  const first = evaluateBudget({ limitMinorUsd: 10000, spentMinorUsd: 8000 })
  assert.equal(first.level, 'warn')
  assert.equal(first.shouldSendAlert, true)

  const second = evaluateBudget({ limitMinorUsd: 10000, spentMinorUsd: 9000, alertSentAt: NOW })
  assert.equal(second.level, 'warn')
  assert.equal(second.shouldSendAlert, false, '경보는 1회만이다')
})

test('100% 도달 시 차단', () => {
  const v = evaluateBudget({ limitMinorUsd: 10000, spentMinorUsd: 10000 })
  assert.equal(v.level, 'blocked')
  assert.equal(v.shouldBlock, true)
})

test('80% 를 건너뛰고 바로 100% 를 넘겨도 경보를 보낸다', () => {
  const v = evaluateBudget({ limitMinorUsd: 10000, spentMinorUsd: 12000 })
  assert.equal(v.level, 'blocked')
  assert.equal(v.shouldSendAlert, true, '한 번에 넘겼다고 경보를 건너뛰면 사용자는 이유를 모른다')
})

test('이미 차단 상태면 다시 차단하지 않는다', () => {
  const v = evaluateBudget({ limitMinorUsd: 10000, spentMinorUsd: 11000, blockedAt: NOW })
  assert.equal(v.shouldBlock, false)
})

test('상한을 올리면 즉시 해제된다 (명세 3.6-4)', () => {
  const v = evaluateBudget({ limitMinorUsd: 50000, spentMinorUsd: 11000, blockedAt: NOW })
  assert.equal(v.level, 'ok')
  assert.equal(v.shouldUnblock, true)
})

test('상한 0 은 "AI 를 쓰지 않겠다" — 한 푼이라도 쓰면 차단', () => {
  assert.equal(evaluateBudget({ limitMinorUsd: 0, spentMinorUsd: 0 }).level, 'ok')
  assert.equal(evaluateBudget({ limitMinorUsd: 0, spentMinorUsd: 1 }).level, 'blocked')
})

test('BigInt 로 들어와도 판정이 같다 (스키마가 BigInt 다)', () => {
  const v = evaluateBudget({ limitMinorUsd: 10000n, spentMinorUsd: 10000n })
  assert.equal(v.level, 'blocked')
})

// ------------------------------------------------------------
// 진입점
// ------------------------------------------------------------

test('canTransit 이 종류별로 올바르게 위임한다', () => {
  assert.equal(canTransit('deal', 'OPEN', 'WON', DEAL_FULL_CTX).ok, true)
  assert.equal(canTransit('recording', 'UPLOADED', 'TRANSCRIBING').ok, true)
  assert.equal(canTransit('suggestion', 'PENDING', 'ACCEPTED', NOT_YET).ok, true)
})

test('모르는 종류는 조용히 통과시키지 않는다', () => {
  assert.equal(canTransit('unknown' as never, 'A', 'B').ok, false)
})

test('assertTransit 은 422 INVALID_TRANSITION 을 던진다', () => {
  assert.throws(
    () => assertTransit('deal', 'WON', 'LOST'),
    (e: unknown) => e instanceof CrmError && e.code === 'INVALID_TRANSITION' && e.status === 422,
  )
})

test('assertTransit 의 문장이 무엇이 부족한지 알려준다', () => {
  try {
    assertTransit('deal', 'OPEN', 'WON', {})
    assert.fail('던졌어야 한다')
  } catch (e) {
    assert.ok(e instanceof CrmError)
    assert.equal(e.message, '성사로 바꾸려면 성사일과 금액이 필요합니다.')
    assert.equal(e.details.reason, 'MISSING_WON_FIELDS')
  }
})

test('허용되는 전이에서는 던지지 않는다', () => {
  assert.doesNotThrow(() => assertTransit('deal', 'OPEN', 'LOST', { lostReason: '예산' }))
})

// ------------------------------------------------------------
// 견적
// ------------------------------------------------------------

test('견적: 항목이 없으면 보낼 수 없다', () => {
  const v = canTransitQuote('DRAFT', 'SENT', { lineCount: 0 })
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'EMPTY_QUOTE')
})

test('★ 견적: 승인이 필요한데 승인이 없으면 보낼 수 없다', () => {
  const v = canTransitQuote('DRAFT', 'SENT', { lineCount: 2, approvalRequired: true })
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'NEEDS_APPROVAL')

  const ok = canTransitQuote('DRAFT', 'SENT', {
    lineCount: 2, approvalRequired: true, approvedAt: new Date(),
  })
  assert.equal(ok.ok, true, '승인을 받으면 보낼 수 있다')
})

test('견적: 승인이 필요 없으면 그냥 보낸다', () => {
  assert.equal(canTransitQuote('DRAFT', 'SENT', { lineCount: 1 }).ok, true)
})

test('견적: 보낸 뒤에는 수락·거절할 수 있다', () => {
  assert.equal(canTransitQuote('SENT', 'ACCEPTED').ok, true)
  assert.equal(canTransitQuote('SENT', 'REJECTED').ok, true)
})

test('★ 견적: 기간이 안 지났는데 만료로 두지 않는다 — 살아 있는 견적이 사라진다', () => {
  const now = new Date('2026-08-17T00:00:00Z')
  assert.equal(canTransitQuote('SENT', 'EXPIRED', { validUntil: '2026-08-31T00:00:00Z', now }).ok, false)
  assert.equal(canTransitQuote('SENT', 'EXPIRED', { validUntil: '2026-08-01T00:00:00Z', now }).ok, true)
  assert.equal(canTransitQuote('SENT', 'EXPIRED', { now }).ok, false, '기간이 없으면 만료도 없다')
})

test('견적: 만료된 것은 초안으로 되돌려 고친다', () => {
  assert.equal(canTransitQuote('EXPIRED', 'DRAFT').ok, true)
  assert.equal(canTransitQuote('EXPIRED', 'SENT').ok, false, '고치지 않고 바로 다시 보낼 수는 없다')
})

test('★ 견적: 수락·거절은 종료다 — 고객 손의 문서를 뒤집지 않는다', () => {
  assert.equal(canTransitQuote('ACCEPTED', 'DRAFT').reason, 'TERMINAL_STATE')
  assert.equal(canTransitQuote('ACCEPTED', 'REJECTED').reason, 'TERMINAL_STATE')
  assert.equal(canTransitQuote('REJECTED', 'SENT').reason, 'TERMINAL_STATE')
})

test('견적: 초안에서 바로 수락으로 건너뛸 수 없다', () => {
  assert.equal(canTransitQuote('DRAFT', 'ACCEPTED').ok, false)
})

test('견적: 같은 상태로의 전이는 전이가 아니다', () => {
  assert.equal(canTransitQuote('DRAFT', 'DRAFT').reason, 'SAME_STATE')
})

test('견적: 공통 진입점 canTransit 으로도 같은 판정이 나온다', () => {
  assert.equal(canTransit('quote', 'DRAFT', 'SENT', { lineCount: 0 }).reason, 'EMPTY_QUOTE')
  assert.equal(canTransit('quote', 'SENT', 'ACCEPTED').ok, true)
})

test('견적: 거부 문장이 무엇을 해야 하는지 알려준다', () => {
  try {
    assertTransit('quote', 'DRAFT', 'SENT', { lineCount: 3, approvalRequired: true })
    assert.fail('던졌어야 한다')
  } catch (e) {
    assert.ok(e instanceof CrmError)
    assert.equal(e.status, 422)
    assert.match(e.message, /승인/)
  }
})
