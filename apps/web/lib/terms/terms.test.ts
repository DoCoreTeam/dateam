/**
 * 용어집 상수 단위 테스트
 *
 * 조사·조수사가 붙는 자리를 특히 본다 — **손으로 적으면 반드시 틀리는 자리**다.
 * (실측: 화면이 21번 "API이(가)"라고 말했다 · v0.7.595)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACTION, BANNED_TERMS, MEETING_CAPTURE_LABEL, createLabel, progress } from './action.ts'
import { ENTITY, SURFACE_LABEL, count, countOnly } from './entity.ts'
import { emptyTitle, failedTo, confirmDelete, notEnough } from './sentence.ts'

test('진행 표기는 공백 + 말줄임표를 둘 다 갖는다', () => {
  assert.equal(progress(ACTION.save), '저장 중…')
  assert.equal(progress(ACTION.delete), '삭제 중…')
  // 실측 위반 모양이 다시 나오지 않는지
  assert.notEqual(progress('삭제'), '삭제중')
})

test('새로 만드는 진입은 「새 {개체}」', () => {
  assert.equal(createLabel(ENTITY.deal.label), '새 딜')
  assert.equal(createLabel(ENTITY.company.label), '새 회사')
})

test('미팅만 「미팅 기록」 — 만드는 게 아니라 받아적는 행위라서', () => {
  assert.equal(MEETING_CAPTURE_LABEL, '미팅 기록')
  assert.notEqual(MEETING_CAPTURE_LABEL, createLabel(ENTITY.meeting.label))
})

test('조수사는 넷뿐이고 개체마다 하나로 고정된다', () => {
  const allowed = new Set(['건', '곳', '명', '개'])
  for (const [key, meta] of Object.entries(ENTITY)) {
    assert.ok(allowed.has(meta.counter), `${key}: 허용되지 않은 조수사 ${meta.counter}`)
  }
  assert.equal(count('deal', 3), '딜 3건')
  assert.equal(count('company', 372), '회사 372곳')
  assert.equal(count('pipeline', 4), '파이프라인 4개')
  assert.equal(countOnly('task', 2), '2건')
})

test('식별자가 겹치지 않는다 — 겹치면 API·URL 이 충돌한다', () => {
  const ids = Object.values(ENTITY).map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length, `중복 식별자: ${ids.join(', ')}`)
})

test('모든 개체가 표면을 갖고, 표면 라벨이 정의돼 있다', () => {
  for (const [key, meta] of Object.entries(ENTITY)) {
    assert.ok(SURFACE_LABEL[meta.surface], `${key}: 표면 라벨 없음`)
  }
})

test('빈 상태 제목이 조사를 맞게 붙인다', () => {
  assert.equal(emptyTitle('deal'), '딜이 아직 없어요')       // 딜 = 받침 ㄹ → 이
  assert.equal(emptyTitle('company'), '회사가 아직 없어요')   // 회사 = 받침 없음 → 가
  assert.equal(emptyTitle('meeting'), '미팅이 아직 없어요')   // 미팅 = 받침 ㅇ → 이
})

test('오류 문장은 사과하지 않고 다음 조치를 준다', () => {
  const msg = failedTo('회의노트', '만들지')
  assert.equal(msg, '회의노트를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
  assert.ok(!/죄송|불편/.test(msg), '오류 문장에 사과가 들어가면 안 된다')
})

test('삭제 확인의 조사는 조수사에 붙는다 — 3건을 / 4개를', () => {
  assert.equal(confirmDelete('meeting', 1), '미팅 1건을 삭제할까요?')
  assert.equal(confirmDelete('company', 3), '회사 3곳을 삭제할까요?')
  // '개'는 받침이 없으므로 '를' 이어야 한다 — 손으로 적으면 '개을'이 나온다
  assert.equal(confirmDelete('pipeline', 4), '파이프라인 4개를 삭제할까요?')
})

test('삭제 확인은 사라지는 것과 남는 것을 둘 다 말한다 (R-5)', () => {
  const msg = confirmDelete('meeting', 1, { alsoGone: '참석자 연결', stays: '회의노트 원본' })
  assert.match(msg, /함께 사라지고/)
  assert.match(msg, /남습니다/)
})

test('근거 부족은 숫자를 지어내지 않는다는 말투를 쓴다', () => {
  assert.match(notEnough('배수', '비교할 게시물이 3건뿐'), /어려워요/)
  assert.match(notEnough('근거'), /부족해/)
})

test('금지어 표는 자기모순이 없고 이유가 적혀 있다', () => {
  const bads = new Set(BANNED_TERMS.map((t) => t.bad))
  for (const t of BANNED_TERMS) {
    assert.ok(!bads.has(t.good), `대체어 「${t.good}」 가 다시 금지어다 — 무한 이관`)
    assert.ok(t.why.trim(), `「${t.bad}」 왜 금지하는지 없음`)
  }
})

test('표준 행위 라벨이 금지어 목록에 들어 있지 않다', () => {
  const bads = new Set(BANNED_TERMS.map((t) => t.bad))
  for (const [key, label] of Object.entries(ACTION)) {
    if (key === 'create') continue // '새' 는 단독으로 안 쓴다
    assert.ok(!bads.has(label), `표준어 「${label}」 가 금지어 목록에 있다`)
  }
})
