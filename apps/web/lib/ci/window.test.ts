import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  normalizeWindowDays, DEFAULT_WINDOW_DAYS, MIN_WINDOW_DAYS, MAX_WINDOW_DAYS,
} from './window.ts'

const here = dirname(fileURLToPath(import.meta.url))
const web = join(here, '..', '..')

test('정상 값은 그대로 통과한다 — 화면 선택지가 바뀌지 않아야 한다', () => {
  for (const n of [7, 28, 90]) assert.equal(normalizeWindowDays(String(n)), n)
})

test('숫자가 아니면 기본값', () => {
  for (const v of ['abc', '', null, undefined, {}, NaN, Infinity]) {
    assert.equal(normalizeWindowDays(v), DEFAULT_WINDOW_DAYS, `${String(v)}`)
  }
})

test('★ 음수는 기본값으로 — "-5일 기준, 표본 0건"이라고 말하던 자리다', () => {
  assert.equal(normalizeWindowDays('-5'), DEFAULT_WINDOW_DAYS)
  assert.equal(normalizeWindowDays(0), DEFAULT_WINDOW_DAYS)
})

test('★ 지나치게 큰 값은 잘라낸다 — 날짜 계산이 넘쳐 "표본 0건"이 되던 자리다', () => {
  assert.equal(normalizeWindowDays('999999'), MAX_WINDOW_DAYS)
  // 잘라낸 값으로 만든 시각이 실제로 유효해야 한다(이게 사고의 본질이었다)
  const iso = new Date(Date.now() - normalizeWindowDays('999999') * 86400_000).toISOString()
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T/, '잘라낸 뒤에도 날짜가 표현 범위를 벗어난다')
})

test('소수는 내림 — 기간 조건에 소수일은 없다', () => {
  assert.equal(normalizeWindowDays(7.9), 7)
  assert.equal(normalizeWindowDays(0.5), MIN_WINDOW_DAYS)
})

test('★ 기간 파싱을 화면마다 다시 짜지 않는다 — 세 곳이 같은 값을 다르게 읽던 결함이다', () => {
  const callers = [
    'app/(ci)/ci/trends/page.tsx',
    'app/api/ci/trends/outliers/route.ts',
    'lib/ci/ai/assistant-server.ts',
  ]
  for (const f of callers) {
    const src = readFileSync(join(web, f), 'utf8')
    assert.match(src, /normalizeWindowDays\(/, `${f}가 기간 정규화 SSOT를 쓰지 않는다`)
    assert.doesNotMatch(src, /Number\([^)]*windowDays[^)]*\)\s*\|\|/,
      `${f}에 검증 없는 기간 파싱이 남아 있다`)
  }
})
