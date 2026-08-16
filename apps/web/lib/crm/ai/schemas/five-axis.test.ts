// 5축 추출 계약 (dacrm F2)
//
// 이 파일이 지키는 것 하나: **근거 없는 것은 CRM 에 들어오지 않는다.**
//
// AI 는 영업 미팅의 애매한 말에서 숫자와 결론을 만들어내려 한다.
// 그게 통과하면 사람은 CRM 에 적힌 것을 사실로 읽고 사업 판단을 한다.
// 그래서 파서와 근거 검사를 별도로 잠근다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFiveAxis, dropUngrounded, countAxes } from './five-axis.ts'
import { buildMeetingExtractPrompt, MEETING_EXTRACT_VERSION } from '../prompts/meeting-extract.v1.ts'

const SEGMENTS = [
  { id: 's1', speaker: '윤재일', text: '3억으로 품의를 올렸습니다.' },
  { id: 's2', speaker: '김도현', text: '8월 안에 가능할까요?' },
]

function base() {
  return {
    who: [], what: [], where: null, risk: [], next: [],
  }
}

test('★ 근거 segmentId 가 전사에 없으면 그 항목은 버려진다 — 지어낸 근거로 값이 들어오면 안 된다', () => {
  const out = parseFiveAxis(JSON.stringify({
    ...base(),
    what: [
      { dealName: '삼성SDS GPU', productOrScope: null, amountMinor: 300000000, currency: 'KRW', confidence: 0.9,
        evidence: { quote: '3억으로 품의', segmentIds: ['s1'] } },
      { dealName: '지어낸 딜', productOrScope: null, amountMinor: 999999999, currency: 'KRW', confidence: 0.9,
        evidence: { quote: '지어낸 근거', segmentIds: ['s99'] } },
    ],
  }))
  const grounded = dropUngrounded(out, new Set(['s1', 's2']))
  assert.equal(grounded.what.length, 1)
  assert.equal(grounded.what[0].amountMinor, 300000000)
})

test('★ 근거가 하나라도 실재하면 살린다 — 과하게 버리면 기능이 없는 것과 같다', () => {
  const out = parseFiveAxis(JSON.stringify({
    ...base(),
    risk: [{ kind: 'BUDGET', polarity: 'NEGATIVE', description: '예산 심의 지연', confidence: 0.8,
      evidence: { quote: '…', segmentIds: ['s99', 's2'] } }],
  }))
  const grounded = dropUngrounded(out, new Set(['s1', 's2']))
  assert.equal(grounded.risk.length, 1)
})

test('전 축이 근거를 잃으면 전부 0이 된다 — 0건은 정상 답이다(지어내지 않았다는 뜻)', () => {
  const out = parseFiveAxis(JSON.stringify({
    ...base(),
    who: [{ name: '박보안', companyName: null, title: '팀장', email: null, role: 'BLOCKER', confidence: 0.9,
      evidence: { quote: '…', segmentIds: ['x'] } }],
    next: [{ title: '문서 전달', dueDate: null, assigneeHint: null, emailDraftGist: null, confidence: 1,
      evidence: { quote: '…', segmentIds: ['y'] } }],
  }))
  const grounded = dropUngrounded(out, new Set(['s1']))
  assert.deepEqual(countAxes(grounded), { who: 0, what: 0, where: 0, risk: 0, next: 0 })
})

test('근거 배열이 비어 있으면 스키마 단계에서 거부한다 — 근거 없는 항목은 애초에 만들 수 없다', () => {
  assert.throws(() => parseFiveAxis(JSON.stringify({
    ...base(),
    risk: [{ kind: 'BUDGET', polarity: 'NEGATIVE', description: 'x', confidence: 0.5,
      evidence: { quote: 'x', segmentIds: [] } }],
  })))
})

test('코드펜스로 감싸 와도 파싱한다 — 모델이 자주 그런다', () => {
  const out = parseFiveAxis('```json\n' + JSON.stringify(base()) + '\n```')
  assert.deepEqual(countAxes(out), { who: 0, what: 0, where: 0, risk: 0, next: 0 })
})

test('WHERE 는 단수다 — 단계는 하나뿐이라 배열로 오면 안 된다', () => {
  const out = parseFiveAxis(JSON.stringify({
    ...base(),
    where: { suggestedStageName: '계약 협상', reason: '…', nextMilestone: null, confidence: 0.8,
      evidence: { quote: '…', segmentIds: ['s2'] } },
  }))
  assert.equal(out.where?.suggestedStageName, '계약 협상')
  const dropped = dropUngrounded(out, new Set(['s1']))
  assert.equal(dropped.where, null)
})

test('★ 프롬프트가 회의 날짜를 알려 준다 — 없으면 "8월 25일"을 엉뚱한 해로 적는다(실측: 2024)', () => {
  const p = buildMeetingExtractPrompt(SEGMENTS, { meetingDate: '2026-08-16' })
  assert.ok(p.includes('2026-08-16'), '회의 날짜가 프롬프트에 없다')
  assert.ok(p.includes('회의가 열린 해'), '연도 규칙이 프롬프트에 없다')
})

test('★ 프롬프트가 우리 쪽 사람을 알려 준다 — 없으면 우리 직원이 고객사 연락처로 등록된다', () => {
  const p = buildMeetingExtractPrompt(SEGMENTS, { ourNames: ['김도현'] })
  assert.ok(p.includes('김도현'))
  assert.ok(p.includes('우리 쪽 사람'))
})

test('프롬프트에 전사 구간 id 가 실린다 — 근거를 댈 방법이 그것뿐이다', () => {
  const p = buildMeetingExtractPrompt(SEGMENTS, {})
  assert.ok(p.includes('[s1]'))
  assert.ok(p.includes('[s2]'))
})

test('단계 이름은 목록 안에서만 고르게 한다 — 없는 단계를 지어내면 반영이 실패한다', () => {
  const p = buildMeetingExtractPrompt(SEGMENTS, { stageNames: ['접촉', '견적·제안'] })
  assert.ok(p.includes('접촉 → 견적·제안'))
})

test('프롬프트 버전이 붙어 있다 — 어느 판이 뽑았는지 못 대면 되돌릴 수 없다', () => {
  assert.match(MEETING_EXTRACT_VERSION, /^meeting_extract@v\d+\.\d+\.\d+$/)
})
