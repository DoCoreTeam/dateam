import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageRanges, POSTGREST_MAX_ROWS } from './page-ranges.ts'

test('★ 1,000줄을 넘는 요청은 나눠 읽는다 — 안 나누면 조용히 1,000줄에서 잘린다', () => {
  assert.deepEqual(pageRanges(3_000), [[0, 999], [1000, 1999], [2000, 2999]])
  assert.deepEqual(pageRanges(2_500), [[0, 999], [1000, 1999], [2000, 2499]])
  assert.deepEqual(pageRanges(420), [[0, 419]])
  assert.deepEqual(pageRanges(0), [])
  for (const [from, to] of pageRanges(12_345)) assert.ok(to - from + 1 <= POSTGREST_MAX_ROWS)
})

test('봉과 판단 읽기가 나눠 읽기를 지난다', async () => {
  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = dirname(fileURLToPath(import.meta.url))
  for (const file of ['store.ts', '../judge/score-recent.ts']) {
    const src = readFileSync(join(here, file), 'utf8')
    assert.match(src, /for \(const \[from, to\] of pageRanges\(/, `${file} 가 한 번에 읽는다`)
    assert.match(src, /\.range\(from, to\)/, `${file} 가 range 로 안 읽는다`)
  }
})
