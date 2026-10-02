/**
 * 적중 목록 쪽 나누기 가드
 *
 * 목록이 `limit(50)` 하나로 잘려 있었다. 실측 2026-10-01: 적중 80건인데 화면은 50건,
 * **나머지 30건은 어디에서도 볼 수 없었다.** 배지도 가져온 수를 세어 「50」이라고 떴다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripComments } from '../../ui/component-scan.ts'
import {
  pageOf, hasMore, isLastPage, PAGE_SIZE, MAX_PAGE_SIZE,
  groupHits, slicePage, type RawHit,
} from './hit-page.ts'

const WEB = new URL('../../../', import.meta.url)
const live = (rel: string): string =>
  stripComments(readFileSync(new URL(rel, WEB), 'utf8'))
    .replace(/^[ \t]*import\s[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')

test('안 준 값은 기본값으로 간다', () => {
  assert.deepEqual(pageOf(undefined, undefined), { offset: 0, limit: PAGE_SIZE })
  assert.deepEqual(pageOf(null, null), { offset: 0, limit: PAGE_SIZE })
})

test('밖에서 온 값을 숫자로 강제한다', () => {
  // 주소창으로 들어오는 값이다. 글자를 그대로 넘기면 질의가 통째로 죽는다
  assert.deepEqual(pageOf('50', '20'), { offset: 50, limit: 20 })
  assert.deepEqual(pageOf('abc', 'xyz'), { offset: 0, limit: PAGE_SIZE })
  assert.deepEqual(pageOf('-10', '0'), { offset: 0, limit: 1 }, '음수와 0 을 안 접었다')
  assert.equal(pageOf('1.9', '2.9').offset, 1, '소수를 안 잘랐다')
})

test('상한을 넘기면 상한으로 접는다', () => {
  // 안 접으면 한 요청이 수천 건을 읽으려 들고 그 요청은 죽는다
  assert.equal(pageOf(0, 99999).limit, MAX_PAGE_SIZE)
  assert.ok(MAX_PAGE_SIZE >= PAGE_SIZE)
})

test('받은 수가 달라고 한 수보다 적으면 끝이다', () => {
  assert.equal(isLastPage(49, 50), true)
  assert.equal(isLastPage(50, 50), false)
})

test('전체를 알면 그걸로 더보기를 판단한다', () => {
  assert.equal(hasMore(50, 80, 50, 50), true, '80건 중 50건을 봤는데 더보기가 없다')
  assert.equal(hasMore(80, 80, 30, 50), false, '다 봤는데 더보기가 남았다')
})

test('전체를 못 세도 더보기를 없애지 않는다', () => {
  // 세는 데 실패했다고 더보기를 없애면 남은 것을 영영 못 본다
  assert.equal(hasMore(50, null, 50, 50), true)
  assert.equal(hasMore(70, null, 20, 50), false, '마지막 쪽인데 더보기가 남았다')
})

test('목록 창구가 쪽을 나눠 주고 실제 건수를 센다', () => {
  const src = live('app/api/rfp/radar/route.ts')
  assert.match(src, /pageOf\s*\(/, '밖에서 온 쪽 값을 안 접는다')
  // 쪽은 **묶은 뒤에** 자른다 — 자른 다음 묶으면 한 공고가 쪽 경계에 걸친다
  assert.match(src, /slicePage\(/, '쪽을 안 나눈다')
  assert.doesNotMatch(src, /\.limit\(50\)/, '고정 상한이 남아 있다')
  // 가져온 수를 세면 배지가 늘 한 쪽 크기를 말한다
  assert.match(src, /total,/, '실제 건수를 안 돌려준다')
  // 점수가 같으면 순서가 흔들려 더보기가 같은 줄을 두 번 준다
  assert.match(src, /order\('id'/, '동점일 때 순서가 안 정해져 있다')
})

test('화면이 이어 받고 앞선 줄을 안 버린다', () => {
  const src = live('components/rfp/RadarRules.tsx')
  assert.match(src, /RFP_RADAR\.hitMore/, '더보기 단추가 없다')
  assert.match(src, /hasMore\(/, '끝에 닿아도 더보기가 남는다')
  // 버리면 더보기를 누를 때마다 화면이 처음으로 돌아간다
  assert.match(src, /append \? \[\.\.\.prev, \.\.\.got\] : got/, '이어 받을 때 앞선 줄을 버린다')
  // 이어 받을 때 선택을 풀면 고르던 것이 사라진다
  assert.match(src, /if \(!append\) setPicked/, '이어 받을 때 선택이 풀린다')
})

test('배지가 가져온 수가 아니라 실제 건수를 말한다', () => {
  const src = live('components/rfp/RadarRules.tsx')
  assert.match(src, /RFP_RADAR\.hitShown\(hits\.length, total\)/, '배지가 실제 건수를 안 말한다')
})

// 한 공고를 한 줄로 — I04a

const hit = (over: Partial<RawHit> = {}): RawHit => ({
  id: 'h1', source_id: 's1', rule_id: 'r1', pre_score: 10, reason: '키워드 AI',
  case_id: null, status: 'new', created_at: '2026-10-01T00:00:00Z', ...over,
})

test('같은 공고는 한 줄로 묶인다', () => {
  // 적중은 규칙마다 하나씩 생긴다. 안 묶으면 같은 공고가 규칙 수만큼 뜬다
  const out = groupHits([
    hit({ id: 'h1', rule_id: 'r1' }),
    hit({ id: 'h2', rule_id: 'r2' }),
    hit({ id: 'h3', source_id: 's2' }),
  ])
  assert.equal(out.length, 2)
  assert.deepEqual(out.find((g) => g.source_id === 's1')?.ids.sort(), ['h1', 'h2'])
})

test('묶어도 왜 걸렸는지를 잃지 않는다', () => {
  const out = groupHits([
    hit({ id: 'h1', rule_id: 'r1', reason: '키워드 AI' }),
    hit({ id: 'h2', rule_id: 'r2', reason: '발주처 조달청' }),
  ])
  assert.deepEqual(out[0].rule_ids, ['r1', 'r2'])
  assert.match(String(out[0].reason), /키워드 AI/)
  assert.match(String(out[0].reason), /발주처 조달청/)
})

test('같은 사유를 두 번 적지 않는다', () => {
  const out = groupHits([hit({ id: 'h1', reason: '최근 공고' }), hit({ id: 'h2', rule_id: 'r2', reason: '최근 공고' })])
  assert.equal(out[0].reason, '최근 공고')
})

test('점수는 가장 높은 것을 쓴다', () => {
  // 낮은 쪽으로 접으면 걸릴 만한 공고가 아래로 내려간다
  const out = groupHits([hit({ id: 'h1', pre_score: 10 }), hit({ id: 'h2', rule_id: 'r2', pre_score: 40 })])
  assert.equal(out[0].pre_score, 40)
  assert.equal(out[0].id, 'h2', '대표 줄이 높은 점수 쪽이어야 한다')
})

test('점수 높은 공고가 앞에 온다', () => {
  const out = groupHits([
    hit({ id: 'a', source_id: 's1', pre_score: 10 }),
    hit({ id: 'b', source_id: 's2', pre_score: 40 }),
  ])
  assert.deepEqual(out.map((g) => g.source_id), ['s2', 's1'])
})

test('묶은 다음에 자른다', () => {
  // 자른 다음 묶으면 한 공고의 적중이 쪽 경계에 걸쳐 묶여도 소용이 없다
  const rows = Array.from({ length: 5 }, (_, i) => ({ i }))
  assert.deepEqual(slicePage(rows, { offset: 0, limit: 2 }), [{ i: 0 }, { i: 1 }])
  assert.deepEqual(slicePage(rows, { offset: 4, limit: 2 }), [{ i: 4 }])
})

test('창구가 묶은 뒤에 자르고 공고 수를 센다', () => {
  const src = live('app/api/rfp/radar/route.ts')
  const groupAt = src.indexOf('groupHits(')
  const sliceAt = src.indexOf('slicePage(')
  assert.ok(groupAt > 0 && sliceAt > groupAt, '자른 다음에 묶는다')
  // 배지는 공고 수를 센다. 적중 수를 세면 화면 줄 수와 안 맞는다
  assert.match(src, /const total = grouped\.length/, '적중 수를 센다')
  // 상한에 닿은 것을 조용히 자르면 없는 것처럼 보인다
  assert.match(src, /truncated:/, '상한에 닿은 것을 안 말한다')
})

test('숨기기가 그 공고의 적중 전부에 걸린다', () => {
  // 하나만 숨기면 나머지가 남아 다음 쪽에서 다시 나온다
  const src = live('components/rfp/RadarRules.tsx')
  // 숨기기와 보이기 **둘 다** 전부에 걸어야 한다. 한 자리만 보면 다른 쪽이 통과시킨다
  const all = (src.match(/ids: row\.ids \?\? \[row\.id\]/g) ?? []).length
  assert.equal(all, 2, `적중 전부에 거는 자리가 ${all}곳이다 — 숨기기와 보이기 둘이어야 한다`)
  assert.doesNotMatch(src, /hits\/\$\{row\.id\}/, '한 건 창구로 숨긴다')
  // 한 번에 숨기기도 묶음의 적중을 전부 편다
  assert.match(src, /flatMap\(\(id\) => byId\.get\(id\)\?\.ids \?\? \[id\]\)/, '고른 줄의 적중을 안 편다')
})

test('서버 첫 렌더도 같은 방식으로 묶는다', () => {
  // 한쪽만 묶으면 첫 화면과 더보기 뒤 화면이 서로 다른 줄 수를 보여 준다
  const src = live('app/(rfp)/rfp/radar/page.tsx')
  assert.match(src, /groupHits\(/, '첫 렌더가 안 묶는다')
  assert.match(src, /slicePage\(/, '첫 렌더가 쪽을 안 자른다')
})
