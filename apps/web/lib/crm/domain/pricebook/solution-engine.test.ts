import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSolutionQuote, gpuClassOf, varsOf } from './solution-engine.ts'
import { GCUBE_EDGE } from './gcube-edge.ts'
import type { SolutionConditions } from './types.ts'

const M = (manwon: number) => BigInt(manwon) * BigInt(10_000)
const EXAMPLE = GCUBE_EDGE.examples![0].conditions

function amountOf(r: ReturnType<typeof buildSolutionQuote>, itemId: string): bigint | null {
  const l = r.composed.lines.find((x) => x.key === itemId)
  return l ? l.amounts.lineTotalMinor : null
}

test('★ 정답 1: 가격표 계산 예시가 그대로 나온다 (라이선스 7,400 구축 1,000 초기 8,400 연 1,110 5년 12,840 만원)', () => {
  const r = buildSolutionQuote(GCUBE_EDGE, EXAMPLE)
  const license = r.composed.sections.find((s) => s.key === '라이선스')!
  const build = r.composed.sections.find((s) => s.key === '구축비')!
  assert.equal(license.totalMinor, M(7400))
  assert.equal(build.totalMinor, M(1000))
  assert.equal(r.onceSupplyMinor, M(8400))
  assert.equal(r.annualSupplyMinor, M(1110))
  assert.equal(r.tcoMinor, M(12840))
  assert.equal(amountOf(r, 'edge-gpu-dc'), M(730 * 4))
  assert.equal(amountOf(r, 'edge-gpu-ws'), M(220 * 6))
  assert.equal(amountOf(r, 'edge-gpu-timed'), M(70 * 8))
  assert.equal(amountOf(r, 'edge-node'), null, '18대는 기본 포함 20대 안이라 추가 노드가 안 들어간다')
  assert.deepEqual(r.violations.filter((v) => v.level === 'block'), [])
})

test('★ 정답 2: 교육기관 10% 면 라이선스 6,660 초기 7,660 연 999 5년 11,656 만원', () => {
  const r = buildSolutionQuote(GCUBE_EDGE, { ...EXAMPLE, companyKind: 'school', discount: 'auto' })
  assert.equal(r.composed.sections.find((s) => s.key === '라이선스')!.totalMinor, M(6660))
  assert.equal(r.onceSupplyMinor, M(7660))
  assert.equal(r.annualSupplyMinor, M(999))
  assert.equal(r.tcoMinor, M(11656))
  assert.equal(amountOf(r, 'edge-build-std'), M(1000), '구축비는 할인 대상이 아니다')
  const filled = r.autoFilled.find((a) => a.field === '할인')
  assert.equal(filled?.provenance.source, 'COMPANY_KIND')
  assert.match(filled?.provenance.note ?? '', /제안값/)
})

test('매년 금액은 1회 합계에 섞이지 않는다 — 견적서 합계는 초기 도입 금액 + 부가세', () => {
  const r = buildSolutionQuote(GCUBE_EDGE, EXAMPLE)
  assert.equal(r.composed.once.totalMinor, M(8400) + M(840))
  assert.equal(r.composed.annual.totalMinor, M(1110) + M(111))
})

test('말하지 않은 조건을 채우고 출처를 단다 — 에디션, 유지보수, 노드', () => {
  const r = buildSolutionQuote(GCUBE_EDGE, {
    picked: [], gpus: [{ model: 'H100', count: 4, timed: false }], nodes: null, training: null, companyKind: null, discount: 'auto',
  })
  const fields = r.autoFilled.map((a) => a.field)
  assert.deepEqual(fields, ['에디션', '유지보수', '노드 수'])
  assert.ok(r.resolved.picked.includes('edge-std'))
  assert.equal(r.resolved.nodes, 20)
  assert.equal(r.violations.filter((v) => v.level === 'block').length, 0)
})

test('GPU 가 300장을 넘으면 STD 가 아니라 ENT 로 채운다', () => {
  const r = buildSolutionQuote(GCUBE_EDGE, {
    picked: [], gpus: [{ model: 'H100', count: 320, timed: false }], nodes: null, training: null, companyKind: null, discount: 'none',
  })
  assert.ok(r.resolved.picked.includes('edge-ent'))
  assert.equal(r.resolved.nodes, 50)
})

test('STD 를 직접 골랐는데 300장을 넘으면 막는다', () => {
  const r = buildSolutionQuote(GCUBE_EDGE, {
    picked: ['edge-std'], gpus: [{ model: 'H100', count: 301, timed: false }], nodes: 20, training: null, companyKind: null, discount: 'none',
  })
  assert.ok(r.violations.some((v) => v.code === 'CAP' && v.level === 'block'))
})

test('ENT 면 옵션 셋이 0원으로 서고 「기본 포함」이 붙는다', () => {
  const r = buildSolutionQuote(GCUBE_EDGE, {
    picked: ['edge-ent'], gpus: [], nodes: null, training: null, companyKind: null, discount: 'none',
  })
  for (const id of ['edge-opt-split', 'edge-opt-portal', 'edge-opt-storage']) {
    const l = r.lines.find((x) => x.itemId === id)!
    assert.equal(l.unitPriceMinor, BigInt(0))
    assert.match(l.remark ?? '', /기본 포함/)
  }
})

test('노드 30대면 추가 노드 10대가 들어간다 (30 − 기본 포함 20)', () => {
  const r = buildSolutionQuote(GCUBE_EDGE, { ...EXAMPLE, nodes: 30 })
  const l = r.lines.find((x) => x.itemId === 'edge-node')!
  assert.equal(l.quantity, 10)
  assert.equal(amountOf(r, 'edge-node'), M(200))
})

test('데이터센터 GPU 는 지정 시간을 고를 수 없다', () => {
  const r = buildSolutionQuote(GCUBE_EDGE, { ...EXAMPLE, gpus: [{ model: 'H100', count: 2, timed: true }] })
  assert.ok(r.violations.some((v) => v.code === 'ELIGIBLE'))
})

test('실사 후 견적 품목을 고르면 보내기를 막는다', () => {
  const r = buildSolutionQuote(GCUBE_EDGE, { ...EXAMPLE, picked: [...EXAMPLE.picked, 'edge-infra'] })
  assert.ok(r.violations.some((v) => v.code === 'SURVEY' && v.level === 'block'))
})

test('STD 와 ENT 를 같이 고르면 막는다', () => {
  const r = buildSolutionQuote(GCUBE_EDGE, { ...EXAMPLE, picked: ['edge-std', 'edge-ent'] })
  assert.ok(r.violations.some((v) => v.code === 'ONE_OF'))
})

test('NPU 는 데이터센터가 아니라 워크스테이션용 라이선스를 받는다', () => {
  assert.equal(gpuClassOf({ model: 'Furiosa RNGD' }), 'NPU')
  assert.equal(gpuClassOf({ model: 'H100 SXM5' }), 'DC')
  assert.equal(gpuClassOf({ model: 'RTX 6000 Ada' }), 'WS')
  const c: SolutionConditions = { ...EXAMPLE, gpus: [{ model: 'RNGD NPU', count: 2, timed: false }] }
  assert.equal(varsOf(c)['gpu.ws'], 2)
  assert.equal(varsOf(c)['gpu.dc'], 0)
})

test('말한 할인율이 기관 종류 규칙보다 먼저다', () => {
  const r = buildSolutionQuote(GCUBE_EDGE, { ...EXAMPLE, companyKind: 'school', discount: 30 })
  const l = r.lines.find((x) => x.itemId === 'edge-std')!
  assert.equal(Number(l.discountPercent), 30)
  assert.equal(l.provenance.discount.source, 'SAID')
})

test('규모 조정: 라이선스 정가 소계가 GPU 수 × 단위 금액을 넘으면 넘는 만큼 할인한다', () => {
  const p = { ...GCUBE_EDGE, rules: [...GCUBE_EDGE.rules, { kind: 'SCALE_CAP' as const, section: '라이선스', varKey: 'gpu.total' as const, perUnitMinor: 7_283_000 }] }
  // H100 1장: 라이선스 정가 15,000,000 + 7,300,000 = 22,300,000 > 1 × 7,283,000
  const r = buildSolutionQuote(p, { picked: ['edge-std', 'edge-maint-std'], gpus: [{ model: 'H100', count: 1, timed: false }], nodes: 20, training: null, companyKind: null, discount: 'none' })
  const lic = r.composed.sections.find((s) => s.key === '라이선스')!
  assert.ok(lic.totalMinor <= BigInt(7_283_000), String(lic.totalMinor))
  assert.ok(lic.totalMinor >= BigInt(7_270_000), '올려 잡은 할인율 탓에 만원 넘게 깎이지는 않는다')
  assert.ok(r.autoFilled.some((a) => a.field === '규모 조정 할인'))
  // 예시(18장)는 상한 13,109.4만원 안이라 손대지 않는다
  const ex = buildSolutionQuote(p, GCUBE_EDGE.examples![0].conditions)
  assert.equal(ex.tcoMinor, BigInt(128_400_000))
})

test('규모 조정: GPU 가 0장이면 걸지 않는다 — 0 × 단위 금액은 전부 할인이 아니다', () => {
  const p = { ...GCUBE_EDGE, rules: [...GCUBE_EDGE.rules, { kind: 'SCALE_CAP' as const, section: '라이선스', varKey: 'gpu.total' as const, perUnitMinor: 7_283_000 }] }
  const r = buildSolutionQuote(p, { picked: ['edge-std'], gpus: [], nodes: 20, training: null, companyKind: null, discount: 'none' })
  assert.equal(r.composed.sections.find((s) => s.key === '라이선스')!.totalMinor, BigInt(15_000_000))
})

/* ── 전환(UPGRADE, P0137) — ENT 전환 구축은 지난 계약을 안다 ────────── */

const ENT_COND = { picked: ['edge-ent'], gpus: [{ model: 'H100', count: 4, timed: false }], nodes: null, training: null, companyKind: null, discount: 'none' as const }

test('STD 를 산 고객이 ENT 를 고르면 전환 구축이 품목 규칙으로 들어간다', () => {
  const r = buildSolutionQuote(GCUBE_EDGE, { ...ENT_COND, owned: ['edge-std'], ownedNote: '2025-03-14 체결 계약' })
  const sw = r.lines.find((l) => l.itemId === 'edge-ent-switch')
  assert.ok(sw, '전환 구축 줄이 없다')
  assert.equal(sw.unitPriceMinor, BigInt(12_000_000))
  assert.equal(sw.provenance.quantity.source, 'RULE')
  assert.match(sw.provenance.quantity.note ?? '', /지난 계약에서 STD 기본 금액을 샀음 \(2025-03-14 체결 계약\)/)
  assert.ok(r.autoFilled.some((a) => a.field === 'ENT 전환 구축'))
  assert.ok(!r.violations.some((v) => v.code === 'UPGRADE_NOT_OWNED'))
})

test('안 산 고객이면 전환 구축이 안 들어가고, 손으로 넣으면 짚어 준다', () => {
  const none = buildSolutionQuote(GCUBE_EDGE, { ...ENT_COND, owned: [] })
  assert.ok(!none.lines.some((l) => l.itemId === 'edge-ent-switch'))
  const forced = buildSolutionQuote(GCUBE_EDGE, { ...ENT_COND, picked: ['edge-ent', 'edge-ent-switch'], owned: [] })
  assert.ok(forced.violations.some((v) => v.code === 'UPGRADE_NOT_OWNED' && v.level === 'warn'))
})

test('STD 고객이라도 STD 를 다시 고르면 전환 구축은 없다', () => {
  const r = buildSolutionQuote(GCUBE_EDGE, { ...ENT_COND, picked: ['edge-std'], owned: ['edge-std'] })
  assert.ok(!r.lines.some((l) => l.itemId === 'edge-ent-switch'))
})
