/**
 * 수집 범위 가드
 *
 * 거르기가 `rfp_sources` 를 최근 500건만 읽었다. 실측 2026-10-01: 공고 567건이라
 * 옛 67건은 어떤 규칙에도 안 걸렸다 — 규칙을 새로 만들어도 그 전에 들어온 공고에는
 * 영영 안 걸리고 사용자는 「규칙이 안 먹는다」로 읽는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripComments } from '../../ui/component-scan.ts'
import { sweepRanges, sweepTruncated, SWEEP_BATCH, MAX_BATCHES } from './sweep-scope.ts'

const WEB = new URL('../../../', import.meta.url)
const live = (rel: string): string =>
  stripComments(readFileSync(new URL(rel, WEB), 'utf8'))
    .replace(/^[ \t]*import\s[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')

test('한 묶음에 안 들어가면 나눠 돈다', () => {
  // 실측 그대로: 567건이면 500건 한 번으로는 67건이 남는다
  const r = sweepRanges(567)
  assert.equal(r.length, 2)
  assert.deepEqual(r[0], { offset: 0, limit: SWEEP_BATCH })
  assert.deepEqual(r[1], { offset: SWEEP_BATCH, limit: SWEEP_BATCH })
})

test('딱 맞으면 한 번만 돈다', () => {
  assert.equal(sweepRanges(SWEEP_BATCH).length, 1)
  assert.equal(sweepRanges(1).length, 1)
})

test('볼 것이 없으면 안 돈다', () => {
  assert.deepEqual(sweepRanges(0), [])
  assert.deepEqual(sweepRanges(-5), [])
})

test('한 번에 도는 양에 상한이 있다', () => {
  /*
    공고는 계속 쌓인다. 한 요청이 전부를 읽으려 들면 어느 날부터 그 요청이 죽고,
    죽으면 아무것도 안 걸린다
  */
  const huge = SWEEP_BATCH * (MAX_BATCHES + 5)
  assert.equal(sweepRanges(huge).length, MAX_BATCHES)
  assert.equal(sweepTruncated(huge), true, '다 못 본 것을 안 말한다')
  assert.equal(sweepTruncated(567), false, '다 봤는데 못 봤다고 한다')
})

test('거르기가 옛 공고도 읽는다', () => {
  const src = live('app/api/rfp/radar/route.ts')
  assert.match(src, /sweepRanges\(/, '범위를 안 나눈다')
  assert.doesNotMatch(src, /from\('rfp_sources'\)[\s\S]{0,300}?\.limit\(500\)/, '최근 500건만 읽는 코드가 남아 있다')
  // 같은 날짜가 여럿이면 쪽마다 순서가 흔들려 어떤 공고는 영영 안 읽힌다
  assert.match(src, /order\('notice_date'[\s\S]{0,200}?order\('id'/, '쪽 사이 순서가 안 정해져 있다')
  // 조용히 끊으면 안 걸린 공고가 없는 것처럼 보인다
  assert.match(src, /sweepTruncated\(/, '다 못 본 것을 안 말한다')
})

test('다시 모아도 적중이 두 벌이 안 된다', () => {
  // 유니크 (rule_id, source_id) 가 최종 방어다. 그 사실이 코드에 적혀 있어야 다음 사람이 안 지운다
  const src = readFileSync(new URL('app/api/rfp/radar/route.ts', WEB), 'utf8')
  assert.match(src, /유니크 \(rule_id, source_id\)/, '왜 두 벌이 안 되는지가 안 적혀 있다')
})
