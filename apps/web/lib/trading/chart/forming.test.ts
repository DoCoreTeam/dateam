/**
 * 화면 봉 — **안 닫힌 봉을 닫힌 것처럼 그리지 않는다**
 *
 * 형성 중인 봉을 확정 봉과 똑같이 그리면, 아직 바뀔 값을 사람이 확정으로 읽는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildDisplayBars, bucketStart, isForming, isChartTimeframe,
  CHART_TIMEFRAMES, DEFAULT_CHART_TIMEFRAME,
} from './forming.ts'
import type { ChartBar } from './series.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = Date.UTC(2026, 8, 30, 0, 0)

/** 1분봉 n개. 값이 분마다 1씩 오른다 */
function bars(n: number, from = 0): ChartBar[] {
  return Array.from({ length: n }, (_, i) => {
    const p = 400 + from + i
    return {
      at: new Date(BASE + (from + i) * 60_000).toISOString(),
      open: p, high: p + 0.5, low: p - 0.5, close: p, volume: 10,
    }
  })
}

const NOW = new Date(BASE + 12 * 60_000 + 30_000) // 12분 30초 지점
const LIVE = { price: 999, observedAt: new Date(BASE + 12 * 60_000 + 25_000).toISOString() }
const OPT = { staleAfterSeconds: 60, live: true }

test('★ 고를 수 있는 단위가 통상 HTS 목록이다', () => {
  assert.deepEqual([...CHART_TIMEFRAMES], [1, 3, 5, 10, 15, 30, 60])
  assert.equal(DEFAULT_CHART_TIMEFRAME, 1)
  // 밖에서 온 값(주소·기억)을 그대로 믿지 않는다
  assert.equal(isChartTimeframe(7), false)
  assert.equal(isChartTimeframe('5'), false)
  assert.equal(isChartTimeframe(5), true)
})

test('★ 구간은 자정 눈금으로 나뉜다 — 거래소 눈금과 맞는다', () => {
  const at = Date.UTC(2026, 8, 30, 0, 7)
  assert.equal(bucketStart(at, 5), Date.UTC(2026, 8, 30, 0, 5))
  assert.equal(bucketStart(at, 1), at)
  assert.equal(bucketStart(at, 60), Date.UTC(2026, 8, 30, 0, 0))
})

test('★ 5분봉은 1분봉 다섯을 묶는다 — 시가는 첫 봉, 종가는 마지막, 고저는 전체', () => {
  const out = buildDisplayBars({ bars: bars(10), minutes: 5, lastPrice: null, now: NOW, ...OPT })
  // 0~4분, 5~9분 두 구간. 10~12분 구간은 봉이 없다
  assert.equal(out.length, 2)
  assert.equal(out[0].open, 400, '시가가 첫 봉이 아니다')
  assert.equal(out[0].close, 404, '종가가 마지막 봉이 아니다')
  assert.equal(out[0].high, 404.5, '고가가 구간 전체가 아니다')
  assert.equal(out[0].low, 399.5, '저가가 구간 전체가 아니다')
  assert.equal(out[0].volume, 50, '거래량을 안 더한다')
  // 묶어도 구간 시각은 자정 눈금이다
  assert.equal(out[1].at, new Date(BASE + 5 * 60_000).toISOString())
})

/**
 * **이 시험이 이 파일의 핵심이다.**
 * 5분봉을 고르면 5분 동안 맨 오른쪽 봉이 자란다 — HTS 가 그렇게 동작한다.
 */
test('★ 지금 구간 봉은 형성 중이고, 현재가로 고·저·종가가 움직인다', () => {
  const out = buildDisplayBars({ bars: bars(13), minutes: 5, lastPrice: LIVE, now: NOW, ...OPT })
  const last = out[out.length - 1]
  assert.ok(isForming(last), '지금 구간 봉이 형성 중으로 안 잡힌다')
  assert.equal(last.close, 999, '현재가가 종가에 안 들어간다')
  assert.ok(last.high >= 999, '현재가가 고가를 안 늘린다')
  // 시가는 그 구간 첫 1분봉 그대로여야 한다 — 현재가가 시가를 바꾸면 안 된다
  assert.equal(last.open, 410, '현재가가 시가를 바꿨다')
  // 앞 구간들은 확정 봉이다
  assert.equal(out.slice(0, -1).some(isForming), false, '지난 구간이 형성 중으로 잡힌다')
})

test('★ 그 구간 1분봉이 아직 없으면 현재가 하나로 봉을 연다', () => {
  // 0~9분 봉만 있고 지금은 12분 30초 → 10~14분 구간에 1분봉이 없다
  const out = buildDisplayBars({ bars: bars(10), minutes: 5, lastPrice: LIVE, now: NOW, ...OPT })
  const last = out[out.length - 1]
  assert.ok(isForming(last), '새 구간 봉을 안 연다')
  assert.equal(last.open, 999)
  assert.equal(last.high, 999)
  assert.equal(last.low, 999)
  assert.equal(last.close, 999)
  assert.equal(last.at, new Date(BASE + 10 * 60_000).toISOString(), '구간 시작이 자정 눈금이 아니다')
})

test('★ 값이 오래되면 형성 봉을 안 그린다 — 멈춘 값을 살아 있는 것처럼 그리지 않는다', () => {
  const stale = { price: 999, observedAt: new Date(BASE + 5 * 60_000).toISOString() }
  const out = buildDisplayBars({ bars: bars(10), minutes: 5, lastPrice: stale, now: NOW, ...OPT })
  assert.equal(out.some(isForming), false, `오래된 값으로 봉을 그린다`)
  // 값이 아예 없어도 안 그린다
  assert.equal(
    buildDisplayBars({ bars: bars(10), minutes: 5, lastPrice: null, now: NOW, ...OPT }).some(isForming),
    false,
  )
})

test('★ 장이 닫혀 있으면 안 그린다 — 안 오는 것이 정상인 자리다', () => {
  const out = buildDisplayBars({ bars: bars(13), minutes: 5, lastPrice: LIVE, now: NOW, staleAfterSeconds: 60, live: false })
  assert.equal(out.some(isForming), false, '장이 닫혔는데 형성 봉을 그린다')
})

test('★ 1분봉을 고르면 마지막 1분봉이 형성 중이다', () => {
  const out = buildDisplayBars({ bars: bars(13), minutes: 1, lastPrice: LIVE, now: NOW, ...OPT })
  assert.equal(out.length, 13)
  assert.ok(isForming(out[12]), '12분 봉이 형성 중으로 안 잡힌다')
  assert.equal(out.filter(isForming).length, 1, '형성 봉이 둘 이상이다')
})

test('★ 0 이나 음수 값으로 봉을 열지 않는다', () => {
  const bad = { price: 0, observedAt: LIVE.observedAt }
  assert.equal(
    buildDisplayBars({ bars: bars(10), minutes: 5, lastPrice: bad, now: NOW, ...OPT }).some(isForming),
    false,
    '0원짜리 봉을 그린다',
  )
})

test('★ 봉이 0건이면 아무것도 안 그린다', () => {
  assert.deepEqual(buildDisplayBars({ bars: [], minutes: 5, lastPrice: LIVE, now: NOW, ...OPT }), [])
})

test('★ 묶는 규칙이 저장 봉과 같은 눈금을 쓴다', () => {
  const src = readFileSync(join(HERE, 'forming.ts'), 'utf8')
  const rollup = readFileSync(join(HERE, '..', 'bars', 'rollup.ts'), 'utf8')
  // 둘 다 자정 눈금으로 나눈다. 여기서 규칙을 새로 적으면 화면 봉과 저장 봉이 갈린다
  assert.match(rollup, /Math\.floor\(barStartAt\.getTime\(\) \/ spanMs\) \* spanMs/)
  assert.match(src, /Math\.floor\(at \/ span\) \* span/, '화면 봉이 다른 눈금을 쓴다')
})
