// CRM 안에서 찾기 (dacrm)
//
// **왜 이 가드가 있는가**: 셸 검색창이 CRM 안에서도 호스트 업무 검색으로 가서,
// "삼성"을 치면 CRM 을 떠나 엉뚱한 결과가 나왔다.
//
// 그리고 CRM 검색을 붙이자마자 실브라우저에서 결함 하나가 더 나왔다:
// **`%` 한 글자로 전체 목록이 덤프됐다**(실측 `%_` → 10건).
// LIKE 에서 `%` 는 "아무거나"이기 때문이다. 검색이 아니라 유출 경로였다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { KIND_LABEL } from './search.ts'
import { sanitizeSearchQuery } from '../../ai-chat/search.ts'

const SRC = readFileSync(new URL('./search.ts', import.meta.url), 'utf8')

test('★ LIKE 메타문자를 막는다 — `%` 하나로 전체 목록이 덤프되면 검색이 아니라 유출이다', () => {
  assert.ok(SRC.includes('sanitizeSearchQuery('), '검색어를 세척하지 않는다')
  assert.ok(SRC.includes('contains: safe'), '세척한 값을 쓰지 않는다')
  assert.ok(!SRC.includes('contains: q,'), '원문을 그대로 질의에 넣는다')
})

test('세척기가 실제로 와일드카드를 죽인다 — 재사용하는 SSOT 가 헛돌면 가드도 헛돈다', () => {
  assert.equal(sanitizeSearchQuery('%_'), '\\%\\_')
  assert.equal(sanitizeSearchQuery('삼성'), '삼성')
  assert.equal(sanitizeSearchQuery('삼'), null, '한 글자는 거의 전부가 걸린다')
  assert.equal(sanitizeSearchQuery('가'.repeat(300)), null, '지나치게 긴 입력은 받지 않는다')
})

test('★ 세척기를 새로 만들지 않고 호스트 SSOT 를 쓴다 — 두 벌이면 한쪽만 고치게 된다', () => {
  assert.ok(SRC.includes("from '../../ai-chat/search.ts'"), '자체 구현을 쓴다')
})

test('★ 한 종류가 화면을 다 먹지 않는다 — 회사 500건이 딜을 밀어내면 못 찾는다', () => {
  assert.ok(SRC.includes('const PER_KIND ='), '종류별 상한이 없다')
  assert.ok(SRC.includes('take: PER_KIND + 1'), '상한 초과를 알아낼 수 없다')
})

test('★ 잘렸으면 잘렸다고 말한다 — 조용히 자르면 "이게 전부"로 읽힌다', () => {
  assert.ok(SRC.includes('truncated'), '잘림을 알리지 않는다')
  const ui = readFileSync(new URL('../../../app/(crm)/crm/search/SearchClient.tsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('truncated &&'), '화면이 잘림을 말하지 않는다')
})

test('끝난 딜은 끝났다고 밝힌다 — 성사된 딜을 진행 중으로 오해하면 두 번 판다', () => {
  assert.ok(SRC.includes("d.status === 'OPEN'"), '딜 상태를 구분하지 않는다')
  assert.ok(SRC.includes("'성사됨'"), '성사를 밝히지 않는다')
})

test('네 종류에 사람이 읽는 이름이 있다', () => {
  assert.equal(KIND_LABEL.company, '회사')
  assert.equal(KIND_LABEL.person, '인물')
  assert.equal(KIND_LABEL.deal, '딜')
  assert.equal(KIND_LABEL.meeting, '미팅')
})

test('★ CRM 안에서는 CRM 을 찾는다 — 검색이 사용자를 지금 보던 곳 밖으로 데려가면 안 된다', () => {
  const layout = readFileSync(new URL('../../../app/(crm)/layout.tsx', import.meta.url), 'utf8')
  assert.ok(layout.includes("action: '/crm/search'"), 'CRM 셸이 검색 목적지를 바꾸지 않는다')
})

test('검색창은 목적지를 받되 기본은 호스트 업무 검색이다 — 다른 셸이 깨지면 안 된다', () => {
  const box = readFileSync(new URL('../../../components/ui/GlobalSearchBox.tsx', import.meta.url), 'utf8')
  assert.ok(box.includes("action = '/work/search'"), '기본값이 바뀌었다')
  assert.ok(box.includes('router.push(`${action}'), '목적지를 쓰지 않는다')
})

test('★ 검색어가 주소에 남는다 — 새로고침·공유에서 같은 결과가 나와야 한다', () => {
  const ui = readFileSync(new URL('../../../app/(crm)/crm/search/SearchClient.tsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('router.push(term ?'), '검색이 주소를 바꾸지 않는다')
  assert.ok(ui.includes('initialQuery'), '주소의 검색어로 시작하지 않는다')
})
