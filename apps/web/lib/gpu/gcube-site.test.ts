import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseGcubePricePage, toListing, GCUBE_MAX_KRW } from './gcube-site.ts'

// 2026-11-03 실페이지에서 뽑은 gpuPrices 156건
const REAL = JSON.parse(readFileSync(new URL('./__fixtures__/gcube-gpuprices-2026-11-03.json', import.meta.url), 'utf8')) as Array<Record<string, unknown>>

/** 실페이지처럼 서버 렌더 조각 안에 이스케이프해 싣는다 */
function pageOf(rows: unknown[], split = 1): string {
  const payload = `0:["$","div",null,{"className":"price__container"}],["$","$L24",null,{"gpuPrices":${JSON.stringify(rows)}}]`
  const size = Math.ceil(payload.length / split)
  const pushes = Array.from({ length: split }, (_, i) =>
    `<script>self.__next_f.push([1,${JSON.stringify(payload.slice(i * size, (i + 1) * size))}])</script>`)
  return `<html><body><div>가격표</div>${pushes.join('')}</body></html>`
}

test('실페이지 데이터 156건을 다 받고 ser 는 겹치지 않는다', () => {
  const r = parseGcubePricePage(pageOf(REAL))
  assert.ok(r)
  assert.equal(r.listings.length, 156)
  assert.equal(r.dropped, 0)
  assert.equal(new Set(r.listings.map((l) => l.ser)).size, 156)
})

test('최대 금액은 기본 + 이용요금이고 전부 원화다', () => {
  const r = parseGcubePricePage(pageOf(REAL))!
  for (const l of r.listings) assert.equal(l.max_krw, l.base_krw + l.usage_krw)
  const b200 = r.listings.find((l) => l.ser === 308)!
  assert.deepEqual([b200.gpu_name, b200.gpu_count, b200.vram_gb, b200.base_krw, b200.max_krw], ['B200', 1, 180, 10500, 15000])
})

test('이름이 같아도 ser 가 다르면 다른 상품이다 (T4 1장 16GB 가 셋)', () => {
  const r = parseGcubePricePage(pageOf(REAL))!
  const t4 = r.listings.filter((l) => l.gpu_name === 'T4' && l.gpu_count === 1 && l.vram_gb === 16)
  assert.ok(t4.length >= 3)
  assert.ok(new Set(t4.map((l) => l.base_krw)).size >= 3)
})

test('조각이 여럿으로 나뉘어도 이어 붙여 읽는다', () => {
  const r = parseGcubePricePage(pageOf(REAL, 7))
  assert.equal(r?.listings.length, 156)
})

test('데이터 자리가 없으면 null (사이트 구조가 바뀐 것을 빈 목록으로 위장하지 않는다)', () => {
  assert.equal(parseGcubePricePage('<html><body>점검 중</body></html>'), null)
  assert.equal(parseGcubePricePage('<script>self.__next_f.push([1,"{\\"gpuPrices\\":[{\\"ser\\":1"])</script>'), null)
})

test('밖에서 온 값: 숫자 아님, 음수, 상한 초과, 원화 아님, 장수 밖은 버린다', () => {
  const ok = { ser: 1, gpuName: 'H100', gpu: 1, price: 100, usagePrice: 50, currencyUnit: 'KRW' }
  assert.ok(toListing(ok))
  assert.equal(toListing({ ...ok, price: 'abc' }), null)
  assert.equal(toListing({ ...ok, price: -1 }), null)
  assert.equal(toListing({ ...ok, usagePrice: -1 }), null)
  assert.equal(toListing({ ...ok, price: GCUBE_MAX_KRW }), null)
  assert.equal(toListing({ ...ok, currencyUnit: 'USD' }), null)
  assert.equal(toListing({ ...ok, gpu: 0 }), null)
  assert.equal(toListing({ ...ok, gpu: 65 }), null)
  assert.equal(toListing({ ...ok, ser: 0 }), null)
  assert.equal(toListing({ ...ok, gpuName: ' ' }), null)
  const r = parseGcubePricePage(pageOf([ok, { ...ok, price: 'x' }, ok]))!
  assert.deepEqual([r.listings.length, r.dropped], [1, 2]) // 둘째는 형식, 셋째는 같은 ser
})
