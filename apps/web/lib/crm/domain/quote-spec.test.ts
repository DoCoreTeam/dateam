import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitSpec, splitInlineMarks, joinSpec } from './quote-spec.ts'

/**
 * 실측 — 견적 DA-2026-0921-05 의 1번 품목 규격.
 * 개행이 하나도 없이 저장돼 있어 견적서에 한 문단으로 쭉 이어졌다(2026-09-21).
 */
const REAL = 'AMD 9355 3.55GHz/32Core x 2Ea, 256GB Mem, 7.68TB U.2 NVMe x 22Ea, 1G-2P, 100G-2P SFP OCP x 1Ea Rack Server - AMD EPYC 9005/9004 Server Processors - 2U DP 24+4-Bay Gen5 NVMe/SATA/SAS-4 (24 x NVMe) Titanium • Dual AMD EPYC 9005/9004 Server Processors • 12-Channel DDR5 RDIMM per CPU with 24 x DIMMs • 2 x 1 Gb/s LAN ports via Intel I350-AM2 • 24 x 2.5" Gen5 NVMe hot-swap bays • 4 x 2.5" SATA/SAS-4 hot-swap bays on the rear side* (*SAS card is required to support SAS drives) • 2 x M.2 slots with PCIe Gen3 x4 and x2 • 1 x FHHL PCIe x16 slot with Gen5 x16 lanes • 1 x OCP NIC 3.0 PCIe Gen5 x16 slot • Compatible with SupremeRAID by Graid Technology • Dual 2000 W 80 PLUS Titanium redundant power supplies • Dimensions (W x H x D, mm) : 2U (438 x 87.5 x 815)'

test('실측 규격이 여러 줄로 갈린다 — 한 문단으로 남지 않는다', () => {
  const got = splitSpec(REAL)
  assert.ok(got.components.length >= 10, `구성이 ${got.components.length}줄뿐`)
  // 첫 줄은 섀시 사양이고, 이어 붙은 제목 두 개가 그 뒤로 떨어져야 한다
  assert.ok(got.spec.endsWith('Rack Server'), `첫 줄이 ${JSON.stringify(got.spec)}`)
  assert.equal(got.components[0], 'AMD EPYC 9005/9004 Server Processors')
})

test('갈린 줄에 표식 글자가 남지 않는다', () => {
  for (const line of splitSpec(REAL).components) {
    assert.ok(!/^[•‣▪◦●○-]/.test(line), `줄머리에 표식이 남음: ${line}`)
  }
})

test('모든 글자가 보존된다 — 가르기는 버리는 일이 아니다', () => {
  const got = splitSpec(REAL)
  const rejoined = [got.spec, ...got.components].join(' ')
  const norm = (s: string) => s.replace(/[\s•‣▪◦●○]+/g, ' ').replace(/\s+-\s+/g, ' ').trim()
  assert.equal(norm(rejoined), norm(REAL))
})

test('표식이 없으면 한 글자도 안 건드린다 — 지어내지 않는다', () => {
  const plain = 'AMD EPYC 9355 (32C/64T, 3.55~4.4GHz, 256MB, 280W)'
  const got = splitSpec(plain)
  assert.equal(got.spec, plain)
  assert.deepEqual(got.components, [])
})

test('모델명 안 하이픈에서 갈리지 않는다', () => {
  const name = 'GIGABYTE R283-Z96-AAJ1 2U Rack Server'
  assert.deepEqual(splitInlineMarks(name), [name])
})

test('짧은 조각이 나오는 대시는 경계가 아니다', () => {
  // 범위 표기가 줄로 갈리면 안 된다. 실제 견적서는 「3.55~4.4GHz」처럼 물결을 쓴다
  const range = 'DDR5 2 - 4 DIMM'
  assert.deepEqual(splitInlineMarks(range), [range])
})

test('숫자 뒤 대시도 경계다 — 막으면 진짜 줄을 잃는다', () => {
  // 실측 DA-2026-0921-04. 한때 숫자 뒤를 범위로 보고 막아 이 줄이 안 갈렸다
  const real = 'AMD 9655 2.6GHz/96Core x 2Ea HPC/AI Server - AMD EPYC 9005/9004 - 4U DP 8 x PCIe GPUs'
  const got = splitInlineMarks(real)
  assert.equal(got.length, 3, `${got.length}조각으로 갈림`)
  assert.equal(got[1], 'AMD EPYC 9005/9004')
})

test('사람이 그은 줄이 표식보다 세다 — 적은 대로 나온다', () => {
  // 개행이 있으면 그 경계만 쓴다. 줄 안의 대시를 우리가 더 가르지 않는다
  const written = 'CPU - 2 way\nRAM - 256GB'
  const got = splitSpec(written)
  assert.equal(got.spec, 'CPU - 2 way')
  assert.deepEqual(got.components, ['RAM - 256GB'])
})

test('빈 값은 빈 값이다', () => {
  assert.deepEqual(splitInlineMarks('   '), [])
  assert.deepEqual(splitSpec(null), { spec: '', components: [] })
})

test('붙였다 가르면 제자리 — joinSpec 과 짝이 맞는다', () => {
  const spec = 'GIGABYTE R283-Z96-AAJ1'
  const components = ['CPU: AMD EPYC 9355 x 2', 'RAM: DDR5-5600 256GB']
  assert.deepEqual(splitSpec(joinSpec(spec, components)), { spec, components })
})
