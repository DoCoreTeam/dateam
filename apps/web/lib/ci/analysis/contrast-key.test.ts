/**
 * 대조쌍 지문 (P0030 I04)
 *
 * 여기서 잠그는 계약은 하나다: **같은 질문에는 같은 지문, 다른 질문에는 다른 지문.**
 * 이 둘 중 하나만 깨져도 절감이 사라지거나(다시 묻는다) 낡은 답이 남는다(안 묻는다).
 *
 * 실측 2026-09-20: 서로 다른 질문이 최대 624개인데 사흘 동안 49,064번 물었다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  contrastKey, splitByKnown, DISCOVERY_PROMPT_VERSION, type StoredAnswer,
} from './contrast-key.ts'

const c = (id: string) => ({ contentId: id })
const set = (w: string, ...p: string[]) => ({ winner: c(w), peers: p.map(c) })
const answer: StoredAnswer = { found: true, statement: 's', observation: 'o', kind: 'hook' }

test('같은 묶음은 같은 지문', () => {
  assert.equal(contrastKey(set('w', 'a', 'b', 'c')), contrastKey(set('w', 'a', 'b', 'c')))
})

test('★ 대조군 순서가 달라도 같은 지문 — 조회 순서가 바뀌는 날 저장이 통째로 빗나가면 안 된다', () => {
  assert.equal(contrastKey(set('w', 'a', 'b', 'c')), contrastKey(set('w', 'c', 'a', 'b')))
})

test('승자와 대조군은 자리가 다르다', () => {
  assert.notEqual(
    contrastKey(set('a', 'b')), contrastKey(set('b', 'a')),
    '승자 a 대조 b 와 승자 b 대조 a 는 다른 질문이다',
  )
})

test('묶음 구성이 달라지면 지문도 달라진다', () => {
  assert.notEqual(contrastKey(set('w', 'a', 'b')), contrastKey(set('w', 'a', 'b', 'c')))
  assert.notEqual(contrastKey(set('w', 'a', 'b')), contrastKey(set('w', 'a', 'z')))
})

test('★ 배수는 지문에 안 들어간다 — 형제가 들어올 때마다 흔들려 절감이 사라진다', () => {
  // 지문 함수는 id 만 받는다. 배수를 얹어 불러도 결과가 같아야 한다.
  const withIndex = {
    winner: { contentId: 'w', outlierIndex: 9.9 },
    peers: [{ contentId: 'a', outlierIndex: 0.7 }, { contentId: 'b', outlierIndex: 1.2 }],
  }
  const later = {
    winner: { contentId: 'w', outlierIndex: 3.1 },
    peers: [{ contentId: 'a', outlierIndex: 1.0 }, { contentId: 'b', outlierIndex: 0.9 }],
  }
  assert.equal(
    contrastKey(withIndex), contrastKey(later),
    '내용이 한 글자도 안 바뀌었는데 배수만 움직여 다시 묻게 되면 저장이 아무 일도 못 한다',
  )
})

test('★ 떡상 자격이 바뀌면 묶음이 달라져 지문도 달라진다 — 낡은 판정이 남지 않는다', () => {
  // 배수를 지문에서 뺀 대가로 놓치는 것이 없는지 확인한다.
  // 자격을 잃은 콘텐츠는 승자 목록에서 빠지므로 묶음 자체가 달라진다.
  const before = set('w', 'a', 'b', 'c')
  const afterDemoted = set('w2', 'a', 'b', 'c')   // w 가 자격을 잃고 다른 승자가 올라옴
  const afterPeerChanged = set('w', 'a', 'b', 'd') // 평범 구간이 움직여 대조군이 바뀜
  assert.notEqual(contrastKey(before), contrastKey(afterDemoted))
  assert.notEqual(contrastKey(before), contrastKey(afterPeerChanged))
})

test('★ 프롬프트 판이 오르면 다시 묻는다 — 질문을 바꿨는데 옛 답이 나오면 안 된다', () => {
  assert.notEqual(contrastKey(set('w', 'a'), 1), contrastKey(set('w', 'a'), 2))
})

test('빈 id 는 지문을 만들지 않는다 — 지어낸 지문으로 남의 답을 집어오면 안 된다', () => {
  assert.throws(() => contrastKey(set('', 'a')), /승자/)
  assert.throws(() => contrastKey(set('w', ' ')), /대조군/)
})

test('아는 것과 물을 것을 가른다', () => {
  const sets = [set('w1', 'a'), set('w2', 'b'), set('w3', 'c')]
  const known = new Map([[contrastKey(sets[1]), answer]])

  const { cached, fresh } = splitByKnown(sets, known)
  assert.equal(cached.length, 1)
  assert.equal(cached[0].set.winner.contentId, 'w2')
  assert.deepEqual(fresh.map((f) => f.set.winner.contentId), ['w1', 'w3'])
})

test('한 판 안에 같은 묶음이 두 번 나와도 한 번만 묻는다', () => {
  const { fresh } = splitByKnown([set('w', 'a'), set('w', 'a')], new Map())
  assert.equal(fresh.length, 1, '저장에 닿기 전이라 저장만으로는 못 거른다')
})

test('못 찾았다는 답도 답이다 — 다시 묻지 않는다', () => {
  const s = set('w', 'a')
  const notFound: StoredAnswer = { found: false, statement: '', observation: '', kind: 'other' }
  const { cached, fresh } = splitByKnown([s], new Map([[contrastKey(s), notFound]]))
  assert.equal(fresh.length, 0, '「없다」를 확인하는 데도 호출 한 번이 들었다')
  assert.equal(cached[0].answer.found, false)
})

test('판 번호는 정수이고 1 이상이다', () => {
  assert.ok(Number.isInteger(DISCOVERY_PROMPT_VERSION) && DISCOVERY_PROMPT_VERSION >= 1)
})
