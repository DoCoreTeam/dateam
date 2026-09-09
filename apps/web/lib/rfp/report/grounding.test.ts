/**
 * 근거 대조·규칙 검증·자기 검토 가드 (설계서 3.6.4)
 *
 * 여기서 잠그는 것 넷
 * - 인용이 원문에서 0.9 로 확인 안 되면 신뢰도가 0.5 이하로 내려가는가
 * - 금액·기간·법정 공고 기간 산술이 불일치를 잡는가
 * - 나라장터 값과 다르면 경고가 붙는가
 * - 자기 검토가 의심스러운 것만 보는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  similarity, checkEvidence, groundValue, groundingRate,
  GROUNDING_SIMILARITY, UNGROUNDED_CONFIDENCE_CAP, type BlockText,
} from './grounding.ts'
import {
  checkSchedule, checkBudget, checkNoticePeriod, compareWithG2b, monthsBetween, daysBetween,
  hasErrors, LEGAL_NOTICE_DAYS, DURATION_TOLERANCE_MONTHS,
} from './rule-verify.ts'
import {
  needsReview, applyReview, planSelfReview, summarize, buildReviewInstruction,
  SELF_REVIEW_CONFIDENCE, MAX_REVIEW_FIELDS, type SelfReviewInput,
} from './self-review.ts'
import { makeValue, MIN_QUOTE_CHARS, type ValueNode } from './schema.ts'

const 원문 = '본 사업의 총 사업비는 금 오백만원정(₩500,000,000)이며 부가가치세를 포함한 금액이다'
const 블록: BlockText[] = [
  { blockId: 'b1', text: 원문 },
  { blockId: 'b2', text: '사업기간은 계약체결일로부터 12개월로 한다' },
]

function 근거(quote: string, blockId = 'b1') {
  return { documentFileId: 'f1', blockId, pageNo: 1, quote }
}

// 유사도

test('원문에 그대로 있으면 1 이다', () => {
  assert.equal(similarity('총 사업비는 금 오백만원정', 원문), 1)
})

test('공백과 줄바꿈 차이는 무시한다', () => {
  assert.equal(similarity('총  사업비는\n금 오백만원정', 원문), 1)
})

test('지어낸 인용은 낮게 나온다', () => {
  // 문장은 그럴듯하고 숫자도 그럴듯해서 사람 눈으로는 안 걸린다
  const 지어냄 = '본 사업의 총 사업비는 금 팔억원정이며 부가세 별도이다'
  assert.ok(similarity(지어냄, 원문) < GROUNDING_SIMILARITY, `유사도가 ${similarity(지어냄, 원문)} 다`)
})

test('빈 인용은 0 이다', () => {
  assert.equal(similarity('', 원문), 0)
})

// 근거 대조

test('가리킨 블록에 있으면 확인이다', () => {
  const c = checkEvidence(근거('총 사업비는 금 오백만원정'), 블록)
  assert.equal(c.ok, true)
  assert.equal(c.blockFound, true)
  assert.equal(c.similarity, 1)
})

test('블록 ID 만 틀렸으면 찾아서 고쳐 준다', () => {
  // 모델이 인용은 맞게 가져오고 ID 만 헷갈리는 일이 흔하다
  const c = checkEvidence(근거('사업기간은 계약체결일로부터 12개월', 'b1'), 블록)
  assert.equal(c.ok, true)
  assert.equal(c.evidence.blockId, 'b2', '안 고치면 화면에서 눌러도 엉뚱한 데로 간다')
})

test('어느 블록에도 없으면 못 찾는다', () => {
  const c = checkEvidence(근거('하자보수 기간은 3년으로 한다'), 블록)
  assert.equal(c.ok, false)
  assert.ok(c.similarity < GROUNDING_SIMILARITY)
})

// 강등

test('근거를 못 찾으면 신뢰도가 0.5 이하로 내려간다', () => {
  const node = makeValue(800_000_000, {
    confidence: 0.95,
    grounding: 'confirmed',
    evidence: [근거('총 사업비는 금 팔억원정이며 부가세 별도이다 ' + '가'.repeat(MIN_QUOTE_CHARS))],
  })
  const r = groundValue(node, 블록)
  assert.equal(r.demoted, true)
  assert.equal(r.node.grounding, 'unconfirmed')
  assert.ok(r.node.confidence !== null && r.node.confidence <= UNGROUNDED_CONFIDENCE_CAP)
})

test('강등해도 값을 지우지 않는다', () => {
  const node = makeValue(800_000_000, { evidence: [근거('없는 문장이다 ' + '나'.repeat(50))] })
  const r = groundValue(node, 블록)
  // 지우면 화면이 「원문에 없음」이 되고 사용자가 그걸 믿는다
  assert.equal(r.node.value, 800_000_000)
})

test('원래 신뢰도가 더 낮으면 그대로 둔다', () => {
  const node = makeValue(1, { confidence: 0.2, evidence: [근거('없다')] })
  assert.equal(groundValue(node, 블록).node.confidence, 0.2)
})

test('신뢰도가 없으면 상한값으로 채운다', () => {
  const node = makeValue(1, { confidence: null, evidence: [근거('없다')] })
  assert.equal(groundValue(node, 블록).node.confidence, UNGROUNDED_CONFIDENCE_CAP)
})

test('근거가 하나라도 맞으면 확인이고 어긋난 근거는 뺀다', () => {
  const node = makeValue(500_000_000, {
    evidence: [근거('총 사업비는 금 오백만원정'), 근거('없는 문장이다')],
  })
  const r = groundValue(node, 블록)
  assert.equal(r.node.grounding, 'confirmed')
  // 어긋난 것을 남기면 화면에서 눌렀을 때 아무 데도 안 간다
  assert.equal(r.node.evidence.length, 1)
})

test('값이 없으면 확인할 것도 없다', () => {
  const r = groundValue(makeValue<number>(null as never), 블록)
  assert.equal(r.demoted, false)
  assert.equal(r.node.grounding, 'unconfirmed')
})

test('근거 확인 비율을 잰다', () => {
  const nodes: ValueNode<unknown>[] = [
    makeValue(1, { grounding: 'confirmed' }),
    makeValue(2, { grounding: 'unconfirmed' }),
    makeValue(null as never),
  ]
  // 값이 없는 것은 분모에서 뺀다 — 안 빼면 빈 리포트가 0% 로 보인다
  assert.equal(groundingRate(nodes), 0.5)
  assert.equal(groundingRate([]), 0)
})

// 산술

test('기간과 시작·종료일이 안 맞으면 잡는다', () => {
  const f = checkSchedule({
    start: '2026-03-01', end: '2026-09-30', durationMonths: 12,
    proposalDeadline: null, bidOpenDate: null, noticeDate: null,
  })
  // 문장으로는 자연스럽고 인용도 진짜인데 더해 보면 안 맞는 자리다
  assert.ok(f.some((x) => x.ruleId === 'schedule.duration_mismatch'))
  assert.ok(hasErrors(f))
})

test('월 길이 차이만큼은 봐준다', () => {
  const f = checkSchedule({
    start: '2026-03-01', end: '2027-03-01', durationMonths: 12,
    proposalDeadline: null, bidOpenDate: null, noticeDate: null,
  })
  assert.deepEqual(f, [])
  assert.ok(DURATION_TOLERANCE_MONTHS > 0)
})

test('종료일이 시작일보다 앞서면 오류다', () => {
  const f = checkSchedule({
    start: '2026-09-01', end: '2026-03-01', durationMonths: null,
    proposalDeadline: null, bidOpenDate: null, noticeDate: null,
  })
  assert.ok(f.some((x) => x.ruleId === 'schedule.end_before_start' && x.severity === 'error'))
})

test('개찰이 마감보다 앞서면 짚는다', () => {
  const f = checkSchedule({
    start: null, end: null, durationMonths: null,
    proposalDeadline: '2026-04-10', bidOpenDate: '2026-04-05', noticeDate: null,
  })
  assert.ok(f.some((x) => x.ruleId === 'schedule.open_before_deadline'))
})

test('개월 수와 날짜 수 계산이 맞다', () => {
  assert.ok(Math.abs(monthsBetween('2026-01-01', '2027-01-01')! - 12) < 0.2)
  assert.equal(daysBetween('2026-03-01', '2026-03-11'), 10)
  assert.equal(monthsBetween('말도 안 되는 값', '2026-01-01'), null)
})

// 법정 공고 기간

test('법정 공고 기간을 표로 갖고 있다', () => {
  // 모델에 물으면 그럴듯하게 틀린다
  assert.equal(LEGAL_NOTICE_DAYS.negotiated, 40)
  assert.equal(LEGAL_NOTICE_DAYS.general, 7)
})

test('공고 기간이 짧으면 경고한다', () => {
  const f = checkNoticePeriod('2026-03-01', '2026-03-20', 'negotiated')
  assert.equal(f.length, 1)
  assert.equal(f[0].severity, 'warning', '위법이라 단정하지 않는다')
  assert.match(f[0].message, /40일/)
})

test('충분하면 아무 말도 안 한다', () => {
  assert.deepEqual(checkNoticePeriod('2026-03-01', '2026-05-01', 'negotiated'), [])
  assert.deepEqual(checkNoticePeriod(null, '2026-05-01', 'general'), [])
})

// 금액

test('부가세 포함 여부가 없으면 짚는다', () => {
  const f = checkBudget({ totalAmount: 500_000_000, vatIncluded: null, mentions: [] })
  // 안 적으면 제안 가격이 10% 틀린다
  assert.ok(f.some((x) => x.ruleId === 'budget.vat_unknown'))
})

test('총액과 다른 금액이 있으면 짚되 오류는 아니다', () => {
  const f = checkBudget({ totalAmount: 500_000_000, vatIncluded: true, mentions: [500_000_000, 300_000_000] })
  const hit = f.find((x) => x.ruleId === 'budget.amount_mismatch')
  // 배정예산·추정가격·기초금액이 섞여 있는 것이 정상이다
  assert.ok(hit)
  assert.equal(hit!.severity, 'warning')
})

test('부가세 관계로 보이는 금액은 그렇게 말한다', () => {
  const f = checkBudget({ totalAmount: 500_000_000, vatIncluded: true, mentions: [550_000_000] })
  assert.ok(f.some((x) => x.ruleId === 'budget.vat_pair'))
})

test('금액이 0 이하면 오류다', () => {
  assert.ok(hasErrors(checkBudget({ totalAmount: 0, vatIncluded: true, mentions: [] })))
})

// 나라장터 대조

test('공고 금액과 문서 금액이 다르면 경고한다', () => {
  const f = compareWithG2b(
    { noticeNo: '2026-1', title: 'ㄱ', agency: '한국전력공사', budgetAmount: 500_000_000, proposalDeadline: '2026-04-10' },
    { title: 'ㄱ', agency: '한국전력공사', budgetAmount: 300_000_000, proposalDeadline: '2026-04-10' },
  )
  assert.equal(f.length, 1)
  assert.equal(f[0].ruleId, 'g2b.budget_mismatch')
  // 정정공고로 바뀌었을 수도 있다. 문서 쪽을 틀렸다고 단정하지 않는다
  assert.equal(f[0].severity, 'warning')
})

test('마감일이 다르면 경고한다', () => {
  const f = compareWithG2b(
    { noticeNo: null, title: null, agency: null, budgetAmount: null, proposalDeadline: '2026-04-10' },
    { title: null, agency: null, budgetAmount: null, proposalDeadline: '2026-04-20' },
  )
  assert.ok(f.some((x) => x.ruleId === 'g2b.deadline_mismatch'))
})

test('기관 이름의 장식은 무시한다', () => {
  const f = compareWithG2b(
    { noticeNo: null, title: null, agency: '(재)한국사회보장정보원', budgetAmount: null, proposalDeadline: null },
    { title: null, agency: '한국사회보장정보원', budgetAmount: null, proposalDeadline: null },
  )
  assert.deepEqual(f, [])
})

test('기관이 정말 다르면 짚는다', () => {
  const f = compareWithG2b(
    { noticeNo: null, title: null, agency: '한국전력공사', budgetAmount: null, proposalDeadline: null },
    { title: null, agency: '한국수자원공사', budgetAmount: null, proposalDeadline: null },
  )
  assert.ok(f.some((x) => x.ruleId === 'g2b.agency_mismatch'))
})

// 자기 검토

function 검토입력(over: Partial<SelfReviewInput> & { field: string }): SelfReviewInput {
  const node = over.node ?? makeValue(1, { confidence: 0.95 })
  return {
    field: over.field,
    node,
    grounding: over.grounding ?? { node, checks: [], demoted: false },
    rules: over.rules ?? [],
  }
}

test('의심스러운 것만 다시 본다', () => {
  // 전부 다시 물으면 비용이 두 배가 된다
  assert.equal(needsReview(검토입력({ field: 'a' })), false)

  const node = makeValue(1, { confidence: 0.9 })
  assert.equal(needsReview(검토입력({
    field: 'b', node, grounding: { node, checks: [], demoted: true },
  })), true)

  assert.equal(needsReview(검토입력({
    field: 'totalAmount',
    rules: [{ ruleId: 'r', severity: 'error', message: 'm', fields: ['budget.totalAmount'] }],
  })), true)

  assert.equal(needsReview(검토입력({
    field: 'c', node: makeValue(1, { confidence: SELF_REVIEW_CONFIDENCE - 0.01 }),
  })), true)
})

test('검토 결과를 값에 반영한다', () => {
  const node = makeValue(1, { confidence: 0.9, grounding: 'confirmed', evidence: [근거('총 사업비')] })
  assert.equal(applyReview(node, { field: 'a', verdict: 'keep', reason: '' }), node)
  assert.equal(applyReview(node, { field: 'a', verdict: 'lower_confidence', reason: '' }).confidence, 0.4)

  const dropped = applyReview(node, { field: 'a', verdict: 'drop_value', reason: '원문에 없음' })
  assert.equal(dropped.value, null)
  // 근거는 남긴다 — 사람이 「모델은 여길 봤는데 아니라고 판단했구나」를 볼 수 있게
  assert.equal(dropped.evidence.length, 1)
})

test('검토 대상이 많으면 확신 낮은 것부터 자르고 몇 개를 안 봤는지 남긴다', () => {
  const inputs = Array.from({ length: MAX_REVIEW_FIELDS + 5 }, (_, i) => {
    const node = makeValue(1, { confidence: i / 100 })
    return 검토입력({ field: `f${i}`, node, grounding: { node, checks: [], demoted: true } })
  })
  const plan = planSelfReview(inputs)
  assert.equal(plan.fields.length, MAX_REVIEW_FIELDS)
  // 조용히 자르면 「전부 검토됨」으로 읽힌다
  assert.equal(plan.skipped, 5)
  assert.equal(plan.fields[0], 'f0', '확신이 가장 낮은 것부터')
})

test('검토 프롬프트가 뽑을 때와 목표가 다르다', () => {
  const p = buildReviewInstruction(['budget.totalAmount'])
  assert.match(p, /틀린 것을 찾는 것/)
  assert.match(p, /사유 없이 keep 만 적지 않는다/)
})

test('검토 결과를 요약한다', () => {
  const s = summarize([
    { field: 'a', verdict: 'keep', reason: '' },
    { field: 'b', verdict: 'lower_confidence', reason: '' },
    { field: 'c', verdict: 'drop_value', reason: '' },
  ], 2)
  assert.deepEqual(s, { reviewed: 3, kept: 1, lowered: 1, dropped: 1, skipped: 2 })
})
