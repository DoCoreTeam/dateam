// lib/meeting/digest-budget.test.ts — 정리가 뒷일의 시간을 먹지 않는지
//
// 실측 2026-09-14 「시티큐브 내부 미팅」:
//   07:55:43 끝내기 → 08:00:38 정리본 저장(295초) → 라우트 상한 300초에 잘림.
//   `crm_ai_run` 에 행이 없다 = 5축은 모델을 부르던 중에 죽었고, 실패 기록조차 못 남겼다.
// 원인은 종합 호출이 예산을 안 보고 자기 상한(240초)을 새로 쓴 것.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { digestCallBudget, MIN_CALL_MS } from './digest-budget.ts'

/** 끝내기가 정리에 주는 예산과 모듈 상한 — 사고 당시 값 그대로 */
const FINISH_BUDGET_MS = 170_000
const DIGEST_CALL_MS = 120_000
const DIGEST_OVERALL_MS = 240_000

test('★ 예산이 상한보다 작으면 예산이 이긴다 — 이걸 안 해서 295초가 됐다', () => {
  const b = digestCallBudget(FINISH_BUDGET_MS, DIGEST_CALL_MS, DIGEST_OVERALL_MS)
  assert.equal(b.overallTimeoutMs, FINISH_BUDGET_MS)
  assert.ok(b.overallTimeoutMs <= FINISH_BUDGET_MS)
  assert.ok(b.timeoutMs <= b.overallTimeoutMs, '한 번의 시도가 전체보다 길 수 없다')
})

test('★ 사고 재현 — 압축이 쓴 만큼 종합의 몫이 줄어 합이 예산을 안 넘는다', () => {
  // 압축 루프가 105초를 쓰고 넘어온 순간
  const spentByCondense = 105_000
  const remaining = FINISH_BUDGET_MS - spentByCondense
  const b = digestCallBudget(remaining, DIGEST_CALL_MS, DIGEST_OVERALL_MS)

  assert.equal(b.overallTimeoutMs, remaining)
  assert.ok(spentByCondense + b.overallTimeoutMs <= FINISH_BUDGET_MS,
    `정리 합 ${spentByCondense + b.overallTimeoutMs}ms 가 예산 ${FINISH_BUDGET_MS}ms 를 넘는다`)

  // 옛 동작이었다면 105 + 240 = 345초 — 300초 상한을 넘겨 5축이 죽는다
  assert.ok(spentByCondense + DIGEST_OVERALL_MS > 300_000, '사고 조건 자체가 재현돼야 의미가 있다')
})

test('예산이 없으면 모듈 상한 그대로 — 정리 전용 라우트 회귀 0', () => {
  const b = digestCallBudget(Number.POSITIVE_INFINITY, DIGEST_CALL_MS, DIGEST_OVERALL_MS)
  assert.equal(b.overallTimeoutMs, DIGEST_OVERALL_MS)
  assert.equal(b.timeoutMs, DIGEST_CALL_MS)
})

test('예산이 상한보다 크면 상한이 이긴다 — 남는다고 더 쓰지 않는다', () => {
  const b = digestCallBudget(600_000, DIGEST_CALL_MS, DIGEST_OVERALL_MS)
  assert.equal(b.overallTimeoutMs, DIGEST_OVERALL_MS)
})

test('예산이 바닥나도 최저 시간은 남긴다 — 0 은 「네트워크 오류」로 둔갑한다', () => {
  for (const remaining of [0, 1, 4_999]) {
    const b = digestCallBudget(remaining, DIGEST_CALL_MS, DIGEST_OVERALL_MS)
    assert.equal(b.overallTimeoutMs, MIN_CALL_MS, `남은 ${remaining}ms`)
    assert.equal(b.timeoutMs, MIN_CALL_MS)
  }
})

/*
  ── 정적 가드 ────────────────────────────────────────────────────────────────

  산수를 고쳐 놔도 호출부가 다시 고정 상수를 넘기면 그대로 되돌아간다.
  실제로 압축 루프는 예산을 보는데 종합 호출만 안 보던 것이 이 사고였다 —
  «한 곳만 고쳐진» 상태가 눈에 안 띈다는 것이 요점이다.
*/
test('★ 정리의 AI 호출은 전부 digestCallBudget 를 거친다 (고정 상수 직접 전달 금지)', () => {
  const src = readFileSync('lib/meeting/digest-run.ts', 'utf-8')

  /*
    인자 블록을 줄 단위로 읽는다. `indexOf('})')` 로 끊으면
    `buildMeetingDigestPrompt({ ... })` 안의 닫는 짝에 먼저 걸려 블록이 잘린다.
  */
  const lines = src.split('\n')
  const calls = lines
    .map((line, i) => ({ line: i + 1, i }))
    .filter(({ i }) => lines[i].includes('callGeminiJson({'))
    .map(({ line, i }) => {
      const body: string[] = []
      for (let j = i + 1; j < lines.length && !/^\s*\}\)\s*$/.test(lines[j]); j += 1) body.push(lines[j])
      return { line, body: body.join('\n') }
    })

  assert.ok(calls.length >= 2, `정리의 AI 호출을 못 찾았다 (찾은 수 ${calls.length})`)

  const offenders = calls.filter(({ body }) => !body.includes('digestCallBudget('))

  assert.deepEqual(offenders.map((o) => `digest-run.ts:${o.line}`), [],
    'digest-run.ts 의 callGeminiJson 중 예산을 안 보는 호출이 있다.'
    + ' `...digestCallBudget(budget.remaining(), 시도상한, 전체상한)` 로 넘길 것')

  assert.ok(!/timeoutMs:\s*[A-Z_]+_MS/.test(src),
    '모듈 상수를 timeoutMs 로 직접 넘기고 있다 — 예산을 우회하는 길이다')
})

test('메모만 있는 경로도 예산을 받는다 — 녹음이 없다고 시간이 공짜는 아니다', () => {
  const src = readFileSync('lib/gemini-meeting.ts', 'utf-8')
  assert.match(src, /overallTimeoutMs/,
    'summarizeMeeting 이 시간을 안 받으면 기본 120초를 제 몫으로 쓴다')
})
