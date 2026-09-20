/**
 * 관리자 사용량 화면이 원장을 읽는다 (P0030 I09)
 *
 * ## 무엇을 막는가
 *
 * 화면이 `ai_token_logs` 를 읽고 있었다. 그 표는 토큰을 적는 자리라 **안 나간 호출이
 * 아예 없다** — 한도에 걸려 거절된 것도, 저장된 답으로 해결해 안 부른 것도 안 남는다.
 * 실측 2026-09-20: 사흘 50,243건 중 47,055건이 실패였는데 화면은 성공분의 토큰만 보여 줬다.
 * 「왜 이렇게 많이 나갔나」에 답할 수 없는 화면이었다.
 *
 * 여기서 보는 것은 셈이다. 특히 **거절과 실패를 따로 세는가** — 합치면
 * 「벤더가 거절했다」와 「우리가 안 보냈다」가 같은 숫자가 되고, 그러면
 * 상한을 올려야 하는지 프롬프트를 고쳐야 하는지 못 가린다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { foldByFeature, totalsOf, isDenied, type CallRow } from './usage-query.ts'
import type { BudgetLimit } from './budget.ts'

const 상한 = (feature: string, daily: number): BudgetLimit =>
  ({ feature, dailyLimit: daily, perMinuteLimit: 5, enabled: true })

const 줄 = (o: Partial<CallRow> & { surface: string }): CallRow => ({
  ok: true, error: null, input_tokens: 10, output_tokens: 5,
  created_at: '2026-09-20T01:00:00.000Z', ...o,
})

test('★ 거절과 실패를 따로 센다', () => {
  const rows = [
    줄({ surface: 'ci/discover' }),
    줄({ surface: 'ci/discover', ok: false, error: '429 quota' }),
    줄({ surface: 'ci/discover', ok: false, error: 'ai_budget_denied(daily): 하루 한도 소진' }),
  ]
  const [u] = foldByFeature(rows, new Map())
  assert.equal(u.total, 3)
  assert.equal(u.ok, 1)
  assert.equal(u.failed, 1, '벤더가 거절한 것')
  assert.equal(u.denied, 1, '우리가 안 보낸 것')
})

test('★ 거절은 한도를 안 쓴다 — 막혔는데 남은 것까지 줄면 숫자가 사람을 속인다', () => {
  const rows = [
    줄({ surface: 'rfp' }),
    줄({ surface: 'rfp' }),
    줄({ surface: 'rfp', ok: false, error: 'ai_budget_denied(daily): 소진' }),
    줄({ surface: 'rfp', ok: false, error: 'ai_budget_denied(daily): 소진' }),
  ]
  const [u] = foldByFeature(rows, new Map([['rfp', 상한('rfp', 10)]]))
  assert.equal(u.denied, 2)
  assert.equal(u.remaining, 8, '거절 둘까지 한도에서 빼 버렸다')
})

test('★ 상한을 모르면 남은 횟수가 숫자가 아니라 「모른다」다', () => {
  const [u] = foldByFeature([줄({ surface: 'crm' })], new Map())
  assert.equal(u.remaining, null, '모르는 것을 0 이나 무한으로 적으면 둘 다 거짓말이다')
  assert.equal(u.limit, null)
})

test('★ 상한만 있고 오늘 한 번도 안 부른 기능도 보인다 — 0 도 답이다', () => {
  const rows = foldByFeature([], new Map([['meeting/stt', 상한('meeting/stt', 20)]]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].total, 0)
  assert.equal(rows[0].remaining, 20)
})

test('★ 한도를 다 쓴 기능은 남은 것이 0 이고 합계가 그 수를 센다', () => {
  const rows = [줄({ surface: 'a' }), 줄({ surface: 'a' }), 줄({ surface: 'a' })]
  const folded = foldByFeature(rows, new Map([['a', 상한('a', 3)]]))
  assert.equal(folded[0].remaining, 0)
  assert.equal(totalsOf(folded).exhausted, 1)
})

test('★ 합계가 기능별 숫자와 어긋나지 않는다', () => {
  const rows = [
    줄({ surface: 'a' }), 줄({ surface: 'b', ok: false, error: '503' }),
    줄({ surface: 'b', ok: false, error: 'ai_budget_denied(per_minute): 분당' }),
  ]
  const folded = foldByFeature(rows, new Map())
  const t = totalsOf(folded)
  assert.equal(t.total, 3)
  assert.equal(t.ok + t.failed + t.denied, t.total, '어느 하나로도 안 세진 줄이 있다')
  assert.equal(t.inputTokens, 30)
})

test('거절 판정은 원장에 적히는 말머리로 한다', () => {
  assert.equal(isDenied({ ok: false, error: 'ai_budget_denied(daily): x' }), true)
  assert.equal(isDenied({ ok: false, error: '429 quota' }), false)
  assert.equal(isDenied({ ok: true, error: null }), false)
})

test('★ 화면이 원장을 읽고 옛 표를 안 읽는다', () => {
  const page = readFileSync(join(process.cwd(), 'app/admin/ai-usage/page.tsx'), 'utf8')
  assert.match(page, /from\('ai_llm_calls'\)/, '원장을 안 읽는다')
  assert.ok(
    !/from\('ai_token_logs'\)/.test(page),
    '옛 표를 아직 읽는다. 그 표에는 안 나간 호출이 아예 없어서 「왜 많이 나갔나」에 답할 수 없다',
  )
  assert.match(page, /from\('ai_call_budget'\)/, '상한을 안 읽어서 남은 횟수를 못 보여 준다')
})

/*
  물려받은 상한도 상한이다 (P0030 I19)

  화면이 정확히 같은 이름만 찾으면, 실제로는 걸리는 상한을 「상한 없음」으로 그린다.
  그러면 관리자가 없는 줄을 또 만들고 좁은 줄이 넓은 줄을 덮는다 — 게이트와 화면이
  다른 규칙을 쓰면 화면이 거짓말을 한다.
*/
test('★ 앞자리에서 물려받은 상한을 「상한 없음」으로 안 그린다', () => {
  const rows = [줄({ surface: 'crm/quick_create' }), 줄({ surface: 'crm/quick_create' })]
  const [u] = foldByFeature(rows, new Map([['crm', 상한('crm', 200)]]))
  assert.equal(u.limit?.feature, 'crm', '물려받은 상한을 못 찾았다')
  assert.equal(u.remaining, 198)
})

test('★ 받아 주는 줄이 있으면 처음 보는 창구도 상한이 있다', () => {
  const [u] = foldByFeature([줄({ surface: '처음보는창구' })], new Map([['*', 상한('*', 40)]]))
  assert.equal(u.limit?.feature, '*')
  assert.equal(u.remaining, 39)
})

test('★ 받아 주는 줄 자체는 창구로 안 센다 — 규칙이지 기능이 아니다', () => {
  const rows = foldByFeature([], new Map([['*', 상한('*', 40)], ['crm', 상한('crm', 200)]]))
  assert.deepEqual(rows.map((r) => r.feature), ['crm'], '받아 주는 줄이 목록에 기능처럼 섰다')
})
