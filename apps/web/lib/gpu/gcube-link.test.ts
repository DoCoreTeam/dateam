import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gpuNameKey, sameConfig, suggestLinks, priceChanged, type LinkProduct } from './gcube-link.ts'
import { toListings } from './gcube-site.ts'

const REAL = toListings(JSON.parse(readFileSync(new URL('./__fixtures__/gcube-gpuprices-2026-11-03.json', import.meta.url), 'utf8'))).listings

const p = (id: string, model_name: string, memory: string | null, gpu_count = 1): LinkProduct => ({ id, model_name, memory, gpu_count })

test('사이트 이름 꼴과 우리 이름 꼴을 같게 본다', () => {
  assert.equal(gpuNameKey('RTX4070TIS'), gpuNameKey('RTX 4070 Ti Super'))
  assert.equal(gpuNameKey('RTX2080SUPER'), gpuNameKey('RTX 2080 Super'))
  assert.equal(gpuNameKey('NVIDIA RTX A5000'), gpuNameKey('RTX A5000'))
  assert.equal(gpuNameKey('RTXPRO2000BLACKWELL'), gpuNameKey('RTX PRO 2000'))
  assert.equal(gpuNameKey('TeslaV100'), gpuNameKey('V100'))
  assert.notEqual(gpuNameKey('H100 SXM'), gpuNameKey('H100'))
  assert.notEqual(gpuNameKey('RTX4070TI'), gpuNameKey('RTX 4070'))
})

test('장수와 장당 메모리가 다르면 같은 구성이 아니다', () => {
  const l = { gpu_name: 'H100', gpu_count: 8, vram_gb: 80 }
  assert.ok(sameConfig(l, p('a', 'H100', '640GB', 8)))
  assert.ok(!sameConfig(l, p('b', 'H100', '80GB', 1)))
  assert.ok(!sameConfig({ ...l, gpu_count: 1 }, p('c', 'H100', '94GB', 1)))
})

test('짝이 양쪽 모두 하나일 때만 제안한다 (T4 1장 16GB 는 사이트에 셋이라 제안 없음)', () => {
  const products = [p('t4', 'T4', '16GB'), p('b200', 'B200', '180GB'), p('h8', 'H100', '640GB', 8)]
  const s = suggestLinks(REAL, products)
  const t4Sers = REAL.filter((l) => sameConfig(l, products[0])).map((l) => l.ser)
  assert.ok(t4Sers.length >= 3)
  for (const ser of t4Sers) assert.equal(s.has(ser), false)
  assert.equal(s.get(308), 'b200') // B200 1장 180GB 는 하나
})

test('우리 쪽에 같은 구성이 둘이면 제안하지 않는다', () => {
  const l = [{ ser: 1, gpu_name: 'A100', gpu_count: 1, vram_gb: 80 }]
  assert.equal(suggestLinks(l, [p('x', 'A100', '80GB'), p('y', 'A100', '80GB')]).size, 0)
})

test('이미 이어진 상품과 모델은 제안에서 빠진다', () => {
  const l = [
    { ser: 1, gpu_name: 'L4', gpu_count: 1, vram_gb: 24, product_id: 'l4' },
    { ser: 2, gpu_name: 'L4', gpu_count: 1, vram_gb: 24, product_id: null },
  ]
  assert.equal(suggestLinks(l, [p('l4', 'L4', '24GB')]).size, 0)
})

test('금액 바뀜은 값 비교다', () => {
  assert.equal(priceChanged(undefined, { base_krw: 1, usage_krw: 0 }), true)
  assert.equal(priceChanged({ ser: 1, base_krw: '10500.00', usage_krw: '4500.00', product_id: null }, { base_krw: 10500, usage_krw: 4500 }), false)
  assert.equal(priceChanged({ ser: 1, base_krw: '10500', usage_krw: '4500', product_id: null }, { base_krw: 9800, usage_krw: 4500 }), true)
})
