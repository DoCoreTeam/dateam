// 딜 화면의 견적 카드가 부르는 창구와 본문이 그대로인지 단정한다 (P0132 I13)
//
// **왜**: 카드의 단추 모양을 바꾸는 일(칠한 단추 줄이기, 보냄을 체크로 내리기)이
// 견적 상태를 바꾸는 요청까지 건드리면, 화면 정리가 데이터 동작 변경이 된다.
// 그래서 단추는 바뀌어도 나가는 요청은 한 글자도 안 바뀌어야 한다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(import.meta.dirname, '../../../components/ui/crm/QuotePanel.tsx'), 'utf8')

/** act(견적, 경로, 본문) — 상태 전이와 승인과 되살리기가 모두 이 한 함수를 지난다(보냄 체크도 확인 뒤 같은 줄을 부른다) */
const actCalls = (src: string): string[] =>
  [...new Set([...src.matchAll(/act\((?:q|quote), '([^']+)', (\{[^}]*\})\)/g)].map((m) => `${m[1]} ${m[2].replace(/\s+/g, ' ')}`))].sort()

test('견적 카드의 상태 전이 요청이 바뀌기 전과 같다', () => {
  assert.deepEqual(actCalls(SRC), [
    "/approve {}",
    "/restore {}",
    "/status { to: 'ACCEPTED' }",
    "/status { to: 'DRAFT' }",
    "/status { to: 'EXPIRED' }",
    "/status { to: 'REJECTED' }",
    "/status { to: 'SENT' }",
  ])
})

test('상태 전이 본문은 version 을 싣고 POST 로 나간다', () => {
  assert.match(SRC, /fetch\(`\/api\/crm\/quotes\/\$\{quote\.id\}\$\{path\}`, \{\s*method: 'POST',/)
  assert.match(SRC, /body: JSON\.stringify\(\{ version: quote\.version, \.\.\.payload \}\)/)
})

test('목록 읽기와 복제와 지우기와 열기 창구가 그대로다', () => {
  assert.ok(SRC.includes("`/api/crm/quotes?dealId=${encodeURIComponent(dealId)}${trash ? '&trash=1' : ''}`"))
  assert.ok(SRC.includes('`/api/crm/quotes/${quote.id}/duplicate`'))
  assert.ok(SRC.includes('JSON.stringify({ mode, variantLabel: label })'))
  assert.ok(SRC.includes("fetch(`/api/crm/quotes/${quote.id}`, { method: 'DELETE' })"))
  assert.ok(SRC.includes("fetch(`/api/crm/quotes/${quote.id}`, { cache: 'no-store' })"))
})

test('훑는 규칙이 헛돌지 않는다 — 일부러 바꾼 본문은 다르게 읽힌다', () => {
  const broken = SRC.replace("act(q, '/status', { to: 'ACCEPTED' })", "act(q, '/status', { to: 'ACCEPTED', notify: true })")
  assert.notDeepEqual(actCalls(broken), actCalls(SRC))
})
