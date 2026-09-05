/**
 * 이름 매칭 — 일일업무와 CRM 을 잇는 지점 (dacrm 정정판)
 *
 * 여기가 틀리면 두 가지 중 하나가 일어난다.
 *   · 못 찾는다 → 일일업무를 아무리 써도 딜에 아무 기록이 안 쌓인다(예전 상태)
 *   · 잘못 찾는다 → 남의 회사에 우리 기록이 붙는다. 지워도 "그런 일이 있었다"는 기억이 남는다
 *
 * 그래서 이 파일은 **"애매하면 안 붙인다"**를 가장 많이 검증한다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { nameKey, matchByName, promptNames } from './name-match.ts'
import type { Candidate } from './name-match.ts'

const crm = (id: string, name: string): Candidate => ({ id, name, source: 'crm' })
const legacy = (id: string, name: string): Candidate => ({ id, name, source: 'legacy' })

test('★ 표기가 흔들려도 같은 회사로 본다 — 사람은 매번 다르게 적는다', () => {
  const keys = ['㈜데이터얼라이언스', '데이터얼라이언스', '주식회사 데이터얼라이언스', '데이터 얼라이언스']
    .map(nameKey)
  assert.equal(new Set(keys).size, 1, `표기별로 다른 키가 나왔다: ${keys.join(' / ')}`)
})

test('★ 실제로 겪은 사례 — Konsttech 와 konst tech 는 같은 회사다', () => {
  assert.equal(nameKey('Konsttech'), nameKey('konst tech'))
})

test('영문 법인격 표기도 흡수한다', () => {
  assert.equal(nameKey('Acme Inc.'), nameKey('ACME'))
  assert.equal(nameKey('Acme Corp'), nameKey('acme'))
})

test('다른 회사를 같다고 하지 않는다 — 흡수가 과하면 남의 회사에 붙는다', () => {
  assert.notEqual(nameKey('에이클라우드'), nameKey('비클라우드'))
  assert.notEqual(nameKey('삼성SDS'), nameKey('삼성전자'))
})

test('빈 이름은 키가 없다', () => {
  assert.equal(nameKey(''), null)
  assert.equal(nameKey('   '), null)
  assert.equal(nameKey(null), null)
  assert.equal(nameKey('㈜'), null, '법인격만 남으면 이름이 아니다')
})

// ------------------------------------------------------------
// 찾기 — 확실할 때만 붙인다
// ------------------------------------------------------------

test('★ 정확히 하나면 붙인다', () => {
  const r = matchByName('㈜삼성SDS', [crm('c1', '삼성SDS'), crm('c2', 'LG CNS')])
  assert.equal(r.matched?.id, 'c1')
  assert.equal(r.ambiguous.length, 0)
})

test('★ 같은 이름이 둘이면 안 붙이고 사람에게 넘긴다 — 틀린 회사보다 안 붙는 게 낫다', () => {
  const r = matchByName('삼성SDS', [crm('c1', '삼성SDS'), crm('c2', '㈜삼성SDS')])
  assert.equal(r.matched, null, '둘 중 하나를 골라 버렸다')
  assert.equal(r.ambiguous.length, 2)
})

test('★ 영업 CRM 이 구 CRM 보다 우선이다 — 이관이 진행될수록 새 쪽으로 옮겨 가야 한다', () => {
  const r = matchByName('삼성SDS', [legacy('old', '삼성SDS'), crm('new', '삼성SDS')])
  assert.equal(r.matched?.id, 'new')
  assert.equal(r.matched?.source, 'crm')
})

test('CRM 에 없으면 구 CRM 에서 찾는다 — 이관 전에도 연결이 끊기면 안 된다', () => {
  const r = matchByName('옛회사', [legacy('old', '옛회사'), crm('other', '다른회사')])
  assert.equal(r.matched?.id, 'old')
})

test('못 찾으면 조용히 비운다 — 억지로 비슷한 것을 고르지 않는다', () => {
  const r = matchByName('처음보는회사', [crm('c1', '삼성SDS')])
  assert.equal(r.matched, null)
  assert.equal(r.ambiguous.length, 0)
})

test('이름이 없으면 아무것도 안 한다', () => {
  assert.equal(matchByName(null, [crm('c1', '삼성SDS')]).matched, null)
  assert.equal(matchByName('', [crm('c1', '삼성SDS')]).matched, null)
})

// ------------------------------------------------------------
// 프롬프트 — 모델이 id 를 지어내지 못하게
// ------------------------------------------------------------

test('★ 프롬프트에는 이름만 넣는다 — id 를 주면 모델이 그럴듯한 id 를 지어낸다', () => {
  const text = promptNames([crm('c1_secret_id', '삼성SDS')])
  assert.match(text, /삼성SDS/)
  assert.ok(!text.includes('c1_secret_id'), 'id 가 프롬프트로 샜다')
})

test('같은 회사가 두 시스템에 있으면 한 번만 넣는다 — 목록이 중복으로 길어지면 모델이 못 읽는다', () => {
  const text = promptNames([crm('c1', '삼성SDS'), legacy('old', '㈜삼성SDS')])
  assert.equal(text, '삼성SDS')
})

test('후보가 없으면 "없음"이라고 말한다 — 빈 문자열을 넣으면 프롬프트가 깨진다', () => {
  assert.equal(promptNames([]), '없음')
})

test('상한을 넘기지 않는다 — 200개가 넘으면 모델이 목록을 제대로 못 읽는다', () => {
  const many = Array.from({ length: 300 }, (_, i) => crm(`c${i}`, `회사${i}`))
  assert.equal(promptNames(many, 200).split(', ').length, 200)
})

// ------------------------------------------------------------
// 병합과 같은 규칙인가 — 두 곳이 갈리면 사용자가 뭘 믿을지 모른다
// ------------------------------------------------------------

test('★ 병합이 "같다"고 본 이름을 연결도 같다고 본다', async () => {
  // merge.ts 의 companyNameKey 는 내부 함수라 직접 못 부른다.
  // 대신 같은 입력에 같은 판정이 나오는지를 확인한다(규칙이 갈리면 여기서 깨진다).
  const pairs: [string, string][] = [
    ['㈜데이터얼라이언스', '데이터얼라이언스'],
    ['Konsttech', 'konst tech'],
    ['Acme Inc.', 'ACME'],
  ]
  for (const [a, b] of pairs) {
    assert.equal(nameKey(a), nameKey(b), `${a} 와 ${b} 의 판정이 병합과 다르다`)
  }
})

/* ── 후보 상한 (v0.7.691) ────────────────────────────────
 *
 * 실측 2026-09-05: crm_person 210명인데 훑기가 상한 200으로 후보를 읽어,
 * 방금 만든 인물이 후보에서 빠졌다. 그러면 CRM 에 있는 사람이 「없는 사람」이 되고
 * 같은 사람이 한 벌 더 생긴다 — 조용히 자르는 것이 사고의 형태다.
 */

test('★ 훑기 상한은 화면 검색 상한보다 넓다 — 자르면 있는 사람을 「없다」로 판정한다', async () => {
  const src = await readFile(new URL('./candidates.ts', import.meta.url), 'utf8')
  const { SWEEP_CANDIDATE_LIMIT } = await import('./candidates.ts')
  const screenLimit = Number(/const LIMIT = (\d+)/.exec(src)?.[1])
  assert.ok(Number.isFinite(screenLimit), '화면 검색 상한을 못 읽었다')
  assert.ok(SWEEP_CANDIDATE_LIMIT > screenLimit,
    `훑기 상한(${SWEEP_CANDIDATE_LIMIT})이 화면 검색 상한(${screenLimit}) 이하다`)
})

test('★ 잘랐으면 잘랐다고 말한다 — 조용히 자르면 같은 사람이 한 벌 더 생긴다', async () => {
  const src = await readFile(new URL('./candidates.ts', import.meta.url), 'utf8')
  assert.match(src, /truncated: people\.length >= limit \|\| companies\.length >= limit/,
    '상한에 닿았는지를 호출부에 알려야 한다')

  const view = await readFile(
    new URL('../../../app/(member)/meeting-notes/attendee-actions.ts', import.meta.url), 'utf8')
  // import 줄만 봐서는 안 된다 — 불러다 놓고 안 쓰면 상한이 그대로 200 이다
  assert.match(view, /loadAttendeeCandidates\(undefined, SWEEP_CANDIDATE_LIMIT\)/,
    '훑기가 넓은 상한을 **호출에서** 실제로 써야 한다')
  assert.match(view, /candidatesTruncated: candidates\.truncated/, '잘림을 화면까지 전달해야 한다')

  const screen = await readFile(
    new URL('../../../app/(member)/meeting-notes/attendees/AttendeeSweepClient.tsx', import.meta.url), 'utf8')
  assert.match(screen, /candidatesTruncated/, '화면이 그 사실을 실제로 말해야 한다')
})
