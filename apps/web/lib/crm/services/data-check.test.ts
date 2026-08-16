/**
 * 데이터 점검 가드
 *
 * 이 기능이 죽는 방식은 하나다: **목록만 길어지는 것**.
 * 그래서 지키는 것도 하나로 모인다 — 찾기는 규칙이(빠짐없이·공짜로),
 * 고르기는 AI 가(이유와 함께·최대 3개). 둘 중 하나라도 무너지면 아무도 안 읽는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import {
  parseDataCheck, buildDataCheckInput, dataCheckPrompt, MAX_PICKS,
  type DataIssue,
} from '../ai/prompts/data-check.v1.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '../../..')
const read = (p: string) => readFileSync(resolve(WEB, p), 'utf8')

const SRC = read('lib/crm/services/data-check.ts')
const ROUTE = read('app/api/crm/data-check/route.ts')
const CARD = read('app/(crm)/crm/settings/DataCheckCard.tsx')
const PAGE = read('app/(crm)/crm/settings/page.tsx')

const ISSUES: DataIssue[] = [
  { key: 'deal:d1:amount', kind: 'deal.amount', label: 'GPU 도입 (삼성SDS)', href: '/crm/deals/d1',
    detail: '금액을 안 정해 예상 매출 합계에서 빠집니다' },
  { key: 'deal:d2:owner', kind: 'deal.owner', label: '서버 증설', href: '/crm/deals/d2',
    detail: '담당자가 없어 아무도 자기 일로 챙기지 않습니다' },
]
const KEYS = ISSUES.map((i) => i.key)

// ── 응답 읽기 ────────────────────────────────────────────────────────────────

test('정상 응답을 그대로 읽는다', () => {
  const r = parseDataCheck(JSON.stringify({
    headline: '금액부터 채우세요',
    picks: [{ key: 'deal:d1:amount', because: '예상 매출에서 빠집니다', todo: '딜에 금액 넣기' }],
  }), KEYS)
  assert.equal(r.picks.length, 1)
  assert.equal(r.picks[0].todo, '딜에 금액 넣기')
})

test('★ 지어낸 key 는 버린다 — 붙일 곳 없는 지적은 눌러도 갈 데가 없다', () => {
  const r = parseDataCheck(JSON.stringify({
    headline: 'x',
    picks: [{ key: 'deal:없는거:amount', because: 'a', todo: 'b' }],
  }), KEYS)
  assert.equal(r.picks.length, 0)
})

test('★ 근거·할 일이 없으면 버린다 — "중요합니다"만으로는 아무도 안 움직인다', () => {
  const r = parseDataCheck(JSON.stringify({
    headline: 'x',
    picks: [
      { key: 'deal:d1:amount', because: '', todo: 'b' },
      { key: 'deal:d2:owner', because: 'a', todo: '' },
    ],
  }), KEYS)
  assert.equal(r.picks.length, 0)
})

test('같은 key 를 두 번 고르지 않는다', () => {
  const r = parseDataCheck(JSON.stringify({
    headline: 'x',
    picks: [
      { key: 'deal:d1:amount', because: 'a', todo: 'b' },
      { key: 'deal:d1:amount', because: 'c', todo: 'd' },
    ],
  }), KEYS)
  assert.equal(r.picks.length, 1)
})

test('★ 고르는 수에 상한이 있다 — 다 고르면 목록을 다시 보여 준 것뿐이다', () => {
  const keys = Array.from({ length: 10 }, (_, i) => `k${i}`)
  const r = parseDataCheck(JSON.stringify({
    headline: 'x',
    picks: keys.map((k) => ({ key: k, because: 'a', todo: 'b' })),
  }), keys)
  assert.equal(r.picks.length, MAX_PICKS)
})

test('빈 picks 도 정답이다 — 급한 게 없으면 없다고 해야 한다', () => {
  const r = parseDataCheck(JSON.stringify({ headline: '급한 건 없어요', picks: [] }), KEYS)
  assert.equal(r.picks.length, 0)
  assert.equal(r.headline, '급한 건 없어요')
})

test('코드펜스·깨진 응답 방어', () => {
  const ok = parseDataCheck('```json\n{"headline":"x","picks":[]}\n```', KEYS)
  assert.equal(ok.headline, 'x')
  assert.throws(() => parseDataCheck('JSON 아님', KEYS))
  assert.throws(() => parseDataCheck(JSON.stringify({ picks: [] }), KEYS))
})

// ── 프롬프트 ────────────────────────────────────────────────────────────────

test('찾은 것을 key 와 함께 넘긴다 — key 가 없으면 고를 수가 없다', () => {
  const s = buildDataCheckInput(ISSUES)
  assert.ok(s.includes('deal:d1:amount'))
  assert.ok(s.includes('예상 매출 합계에서 빠집니다'))
})

test('★ 프롬프트가 "다 중요하다"를 금지한다', () => {
  const p = dataCheckPrompt.build('x')
  assert.ok(p.includes('목록에 있는 것만'), '환각 문제를 막지 않는다')
  assert.ok(p.includes('다 중요하다고 말하면'), '우선순위를 요구하지 않는다')
  assert.ok(p.includes('빈 배열'), '억지 선택을 막지 않는다')
})

// ── 규칙·배선 ───────────────────────────────────────────────────────────────

test('★ 규칙이 보는 것은 "영업이 손해 보는 것"이다 — 빈칸 세기가 아니다', () => {
  for (const phrase of [
    '예상 매출 합계에서 빠집니다',
    '예상 성사일이 지났는데',
    '아무도 자기 일로 챙기지 않습니다',
    '누구에게 연락할지 알 수 없습니다',
  ]) {
    assert.ok(SRC.includes(phrase), `규칙 문장이 없다: ${phrase}`)
  }
})

test('열린 딜만 본다 — 끝난 딜의 빈칸은 고칠 이유가 없다', () => {
  assert.ok(SRC.includes("status: 'OPEN'"), '닫힌 딜까지 훑는다')
})

test('★ AI 가 실패해도 목록은 산다 — 이 구조를 고른 이유가 여기 있다', () => {
  assert.ok(SRC.includes('issues, total: issues.length, review: null'),
    '실패하면 목록까지 사라진다')
  assert.ok(SRC.includes('예산 한도'), '예산 차단을 사람 말로 알리지 않는다')
})

test('★ 여기서 값을 고치지 않는다 — 자동으로 채우면 출처를 아무도 모른다', () => {
  assert.ok(!SRC.includes('.update('), '점검이 값을 고친다')
  assert.ok(!SRC.includes('createSuggestion'), '점검이 제안을 만든다')
})

test('한 번에 묻는 건수에 상한이 있다 — 많이 넣으면 모델이 뭉뚱그린다', () => {
  assert.ok(SRC.includes('MAX_TO_ASK'), '상한이 없다')
})

test('★ 설정 화면에 실제로 붙어 있다 — 만들고 안 꽂으면 없는 기능이다', () => {
  assert.ok(PAGE.includes('<DataCheckCard />'), '카드가 화면에 없다')
})

test('★ 화면이 실제로 이 API 를 부른다', () => {
  assert.ok(CARD.includes('/api/crm/data-check'), '카드가 API 를 안 부른다')
  assert.ok(ROUTE.includes('checkData'), '라우트가 서비스를 안 부른다')
  assert.ok(ROUTE.includes("withCrmApi('MEMBER'"), '인증이 없다')
})

test('★ 화면을 열 때마다 돌지 않는다 — 사람이 안 볼 때도 돈이 든다', () => {
  assert.ok(CARD.includes("method: 'POST'"), 'GET 으로 부르면 열 때마다 돈다')
  assert.ok(!/useEffect\([^)]*run/.test(CARD), '열자마자 자동으로 돈다')
})

test('★ 잘렸으면 잘렸다고 말한다 — 조용히 자르면 "이게 전부"로 읽는다', () => {
  assert.ok(CARD.includes('모두 {result.total}건 중'), '잘림을 안 밝힌다')
})

test('찾은 것마다 열어 볼 길이 있다 — 어디로 가야 하는지 모르면 못 고친다', () => {
  assert.ok(SRC.includes('href:'), '주소를 안 준다')
  assert.ok(CARD.includes('i.href'), '화면이 링크를 안 건다')
})
