// 제안 표시 SSOT (dacrm)
//
// **왜 이 가드가 있는가**: 실브라우저에서 인박스가
// `{"name":"박보안","role":"BLOCKER","title":"팀장",...}` 를 그대로 보여 줬다.
// 사람은 인박스에서 승인/거절을 한다 — 읽을 수 없는 값을 승인하게 두면 안 된다.
//
// 그리고 미팅 상세는 같은 값을 "팀장"으로만 보여 줬다.
// `title` 을 축과 무관하게 먼저 읽어서, 인물의 **직함**이 할 일 제목 자리에 걸린 것이다.
// 그래서 이 파일은 **축별로 읽는지**를 잠근다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeSuggestionValue, TARGET_LABEL, FIELD_LABEL } from './suggestion.ts'

test('★ 인물은 이름이 먼저다 — 예전엔 직함만 보여 "박보안 팀장"이 그냥 "팀장"이었다', () => {
  const v = { name: '박보안', title: '팀장', email: null, role: 'BLOCKER', companyId: 'c1' }
  const s = describeSuggestionValue(v, { axis: 'WHO' })
  assert.ok(s.startsWith('박보안'), s)
  assert.ok(s.includes('팀장'))
  assert.ok(s.includes('반대하는 쪽'), 'BLOCKER 를 사람 말로 바꾸지 않았다')
})

test('역할이 OTHER 면 아무 말도 하지 않는다 — "OTHER"라고 적으면 아는 것처럼 보인다', () => {
  const s = describeSuggestionValue({ name: '윤재일', role: 'OTHER' }, { axis: 'WHO' })
  assert.equal(s, '윤재일')
})

test('★ 금액은 원 단위 정수로 온다 — 그대로 두면 "300000000"이 보인다', () => {
  const s = describeSuggestionValue('300000000', { axis: 'WHAT', field: 'amountMinor' })
  assert.equal(s, '300,000,000 KRW')
})

test('안전 정수를 넘는 금액은 반올림된 거짓 숫자 대신 원값을 보여 준다', () => {
  const big = '99999999999999999999'
  const s = describeSuggestionValue(big, { axis: 'WHAT', field: 'amountMinor' })
  assert.ok(s.includes(big))
})

test('단계 제안은 무엇으로 바뀌는지 말한다', () => {
  const s = describeSuggestionValue('계약 협상', { axis: 'WHERE', field: 'stageId' })
  assert.ok(s.includes('계약 협상'))
})

test('★ 할 일은 제목과 기한이다 — 인물의 직함이 여기 끼어들면 안 된다', () => {
  const v = { title: '보안 문서 전달', dueDate: '2026-08-25', assigneeHint: '우리 측' }
  const s = describeSuggestionValue(v, { axis: 'NEXT' })
  assert.ok(s.includes('보안 문서 전달'))
  assert.ok(s.includes('2026-08-25까지'))
})

test('걸림돌이 부정적이면 그렇게 보인다 — 설명만 보면 좋은 소식인지 모른다', () => {
  const v = { kind: 'RISK', polarity: 'NEGATIVE', description: '보안팀 반대' }
  const s = describeSuggestionValue(v, { axis: 'RISK' })
  assert.ok(s.includes('보안팀 반대'))
  assert.ok(s.startsWith('⚠'))
})

test('빈 값은 화면이 정한 말로 — 화면마다 "(비어 있음)"과 "(내용 없음)"이 다르다', () => {
  assert.equal(describeSuggestionValue(null, { axis: 'WHO' }), '(비어 있음)')
  assert.equal(describeSuggestionValue(null, { axis: 'WHO' }, '(내용 없음)'), '(내용 없음)')
})

test('모르는 모양은 지어내지 않고 있는 그대로 보여 준다', () => {
  const s = describeSuggestionValue({ 이상한: '값' }, { axis: 'UNKNOWN' })
  assert.equal(s, '{"이상한":"값"}')
})

test('대상·필드 라벨이 사람 말이다 — amountMinor 를 화면에 적으면 개발자 말이다', () => {
  assert.equal(TARGET_LABEL.deal, '딜')
  assert.equal(TARGET_LABEL.meeting, '미팅')
  assert.equal(FIELD_LABEL.amountMinor, '금액')
  assert.equal(FIELD_LABEL.stageId, '단계')
})
