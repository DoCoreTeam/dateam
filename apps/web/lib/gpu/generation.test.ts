import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generationOf, generationRank, generationName, GENERATION_RANK } from './generation.ts'

// 실 DB 모델명(gpu_products 활성 99행/72모델, 2026-07-26 조회) 기준 세대 판정 회귀.

test('Blackwell(최신) — B/GB 데이터센터·RTX50·RTX PRO', () => {
  for (const m of ['B200', 'B200 SXM6', 'B300', 'GB200 SXM', 'GB300 SXM',
                    'RTX 5090', 'RTX 5080', 'RTX 5070 Ti', 'RTX 5060', 'RTX 5060 Ti',
                    'RTX Pro 6000', 'RTX PRO 5000', 'RTX PRO 2000']) {
    assert.equal(generationOf(m), 'blackwell', m)
  }
})

test('Hopper — H100(폼팩터 포함)·H200·GH200', () => {
  for (const m of ['H100', 'H100 SXM', 'H100 PCIe', 'H100 NVL', 'H200', 'GH200']) {
    assert.equal(generationOf(m), 'hopper', m)
  }
})

test('Ada — RTX40·L4/L40/L40S·"... Ada"', () => {
  for (const m of ['RTX 4090', 'RTX 4080 Super', 'RTX 4070 Ti Super', 'RTX 4060 Ti',
                    'L4', 'L40', 'L40S',
                    'RTX 6000 Ada', 'RTX 5000 Ada', 'RTX 4500 Ada', 'RTX 4000 Ada']) {
    assert.equal(generationOf(m), 'ada', m)
  }
})

test('Ampere — RTX30·A100/A40/A10·RTX Axxxx', () => {
  for (const m of ['RTX 3090 Ti', 'RTX 3060', 'RTX 3050',
                    'A100', 'A100 PCIe', 'A100 SXM', 'A40', 'A10',
                    'RTX A6000', 'RTX A5000', 'RTX A4000', 'RTX A2000', 'A4000']) {
    assert.equal(generationOf(m), 'ampere', m)
  }
})

test('Turing — RTX20·T4·Quadro RTX', () => {
  for (const m of ['T4', 'Quadro RTX 6000']) {
    assert.equal(generationOf(m), 'turing', m)
  }
})

test('Volta — V100', () => {
  assert.equal(generationOf('V100'), 'volta')
})

test('Pascal/Maxwell/Kepler — Tesla 구형(기본 숨김 대상)', () => {
  for (const m of ['Tesla P100', 'Tesla P40', 'Tesla P4', 'Tesla P6']) assert.equal(generationOf(m), 'pascal', m)
  for (const m of ['Tesla M40', 'Tesla M60', 'Tesla M10']) assert.equal(generationOf(m), 'maxwell', m)
  for (const m of ['Tesla K40', 'Tesla K80']) assert.equal(generationOf(m), 'kepler', m)
})

test('미판정 모델은 unknown(0) — 맨 뒤로', () => {
  assert.equal(generationOf('GX7000 PRO'), 'unknown')
  assert.equal(generationOf('NX9000 MAX'), 'unknown')
  assert.equal(generationRank('NX9000 MAX'), 0)
  assert.equal(generationOf(null), 'unknown')
  assert.equal(generationOf(''), 'unknown')
})

test('최신순 랭크 단조성 — Blackwell > Hopper > Ada > Ampere > Turing > Volta', () => {
  assert.ok(generationRank('RTX 5090') > generationRank('H100'))
  assert.ok(generationRank('H100') > generationRank('RTX 4090'))
  assert.ok(generationRank('RTX 4090') > generationRank('RTX 3060'))
  assert.ok(generationRank('RTX 3060') > generationRank('T4'))
  assert.ok(generationRank('T4') > generationRank('V100'))
  assert.ok(generationRank('V100') > generationRank('Tesla P100'))
  assert.ok(generationRank('Tesla P100') > generationRank('Tesla K80'))
})

test('폼팩터 변형은 같은 세대(H100 SXM/PCIe/NVL = Hopper)', () => {
  assert.equal(generationRank('H100 SXM'), generationRank('H100'))
  assert.equal(generationRank('H100 NVL'), GENERATION_RANK.hopper)
})

test('generationName — 표시명', () => {
  assert.equal(generationName('H100'), 'Hopper')
  assert.equal(generationName('RTX 5090'), 'Blackwell')
  assert.equal(generationName('GX7000 PRO'), '기타')
})
