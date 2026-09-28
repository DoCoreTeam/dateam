/**
 * 가드 — **없는 창구를 밤새 두드리지 않는다, 그리고 없다고 말한다**
 *
 * 실측 2026-09-29: 크론 최근 1000회 중 476회가 `bar_not_ready` 였다. 야간 세션 동안
 * 낮 분봉 창구로 물어보고, 못 받으면 3초 뒤 두 번 더 물어보고, 그래도 없으니
 * 「아직 안 들어왔다」를 남긴 것이다. 하룻밤이면 같은 빈 답을 받으러 2천 번 나간다.
 *
 * 이 시험은 두 가지를 본다 — 비어 있다는 것이 **값**으로 있는가,
 * 그리고 누가 채워 넣었을 때 곧바로 도는가.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NIGHT_QUOTATION, hasNightQuotation,
  NO_NIGHT_QUOTE_REASON, NO_NIGHT_QUOTE_MESSAGE,
} from './night-quote.ts'
import { KIS_QUOTATIONS } from '../broker/endpoints.ts'
import { NIGHT_EQUIVALENT } from '../broker/endpoints.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

test('★ 야간 짝이 비어 있다는 것이 값으로 있다', () => {
  // 주석은 늙는다. 「없다」와 「아직 안 적었다」를 구별하려면 값이어야 한다
  assert.equal(hasNightQuotation('minuteChart'), false)
  assert.deepEqual(NIGHT_QUOTATION, {}, '값이 생겼다면 안내 문구와 tick 의 판정을 다시 보라')
})

test('★ 계좌 조회에는 있는 짝이 시세 조회에는 없다 — 그 비대칭이 이 고장의 뿌리다', () => {
  // 계좌 쪽은 낮·밤이 이어져 있다
  assert.ok(NIGHT_EQUIVALENT.fills, '계좌 조회의 야간 짝이 사라졌다')
  // 시세 쪽은 안 이어져 있고, 그 사실을 이 모듈이 들고 있다
  assert.ok('minuteChart' in KIS_QUOTATIONS, '낮 분봉 창구가 사라졌다')
  assert.equal(hasNightQuotation('minuteChart'), false)
})

test('누가 채워 넣으면 그 자리만 고치면 된다', () => {
  // 채워진 판을 흉내 내 규칙이 그대로 도는지 본다 (실제 값은 안 건드린다)
  const filled: typeof NIGHT_QUOTATION = { minuteChart: { path: '/x', trId: 'Y' } }
  assert.equal(filled.minuteChart?.trId, 'Y')
  // 판정 함수는 표만 본다 — 표를 채우면 판정이 곧바로 따라간다
  assert.equal(Object.keys(NIGHT_QUOTATION).length === 0, !hasNightQuotation('minuteChart'))
})

test('★ 못 부르는 이유가 사람 말과 기계 말 둘 다 있다', () => {
  assert.match(NO_NIGHT_QUOTE_REASON, /^no_night_quote:/, '실행 기록이 읽을 꼴이 아니다')
  assert.ok(NO_NIGHT_QUOTE_MESSAGE.length > 10, '사람이 읽을 말이 없다')
  // 「봉이 아직 안 들어왔다」와 다른 말이어야 한다 — 사람이 할 일이 다르다
  assert.doesNotMatch(NO_NIGHT_QUOTE_MESSAGE, /아직 안 들어왔|잠시/, '기다리면 될 일처럼 말한다')
  assert.match(NO_NIGHT_QUOTE_MESSAGE, /창구/, '무엇이 없는지 안 짚는다')
})

test('★ 밖으로 나가는 주소를 안 더한다 (S4)', () => {
  const src = readFileSync(join(HERE, 'night-quote.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  assert.doesNotMatch(code, /https?:\/\//, '이 모듈이 바깥 주소를 들고 있다')
  // 경로도 지금은 하나도 없다 — 비어 있다는 것이 이 판의 사실이다
  assert.doesNotMatch(code, /\/uapi\//, '주소를 추측해서 채웠다 — 값을 확인하고 넣어야 한다')
})
