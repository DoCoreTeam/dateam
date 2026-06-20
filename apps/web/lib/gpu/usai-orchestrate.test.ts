import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { orchestrateUsai, extractArray, dedupVerified, type CallAI } from './usai-orchestrate.ts'
import type { VerifiedItem } from './intake-verify.ts'

function vItem(over: Partial<VerifiedItem>): VerifiedItem {
  return {
    model_name: 'T4', unit_price_usd: 0.8102, original_price: 1, original_currency: 'KRW',
    original_unit: 'month', gpu_count: 8, term: 'on_demand', target: 'own_target',
    provenance: { model_addr: 'C7', price_addr: 'D7', block_id: 'b1' }, confidence: 1,
    issues: [], needs_human: false, verify_flags: [], ...over,
  }
}

test('dedupVerified: 동일 정규화값 중복은 접고, 다른 값(불일치)은 남김', () => {
  const r = dedupVerified([
    vItem({ provenance: { model_addr: 'C7', price_addr: 'D7', block_id: 'b1' } }),
    vItem({ provenance: { model_addr: 'I7', price_addr: 'J7', block_id: 'b2' } }), // 같은 값 → 접힘
    vItem({ unit_price_usd: 6.48, provenance: { model_addr: 'X', price_addr: 'Y', block_id: 'b3' } }), // 다른 값 → 유지
    vItem({ term: 'on-demand' }), // term 표기차지만 같은 값 → 접힘
  ])
  assert.equal(r.length, 2)
})

test('extractArray: {key:[...]} 객체형과 [...] 배열형 모두 허용', () => {
  assert.equal(extractArray('{"blocks":[{"a":1}]}', 'blocks').length, 1)
  assert.equal(extractArray('[{"a":1},{"a":2}]', 'blocks').length, 2) // 최상위 배열
  assert.equal(extractArray('```json\n[{"x":1}]\n```', 'records').length, 1) // 코드펜스
  assert.equal(extractArray('garbage', 'blocks').length, 0)
})

test('extractArray: 프로토타입 오염 키 거부(H1)', () => {
  const r = extractArray('[{"model_name":"T4","__proto__":{"x":1},"constructor":2}]', 'records')
  assert.equal(r.length, 1)
  assert.equal(Object.prototype.hasOwnProperty.call(r[0], '__proto__'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(r[0], 'constructor'), false)
  assert.equal((r[0] as Record<string, unknown>).model_name, 'T4')
})

// 타겟파일 구조 모사: 한 시트에 2개 가격블록(8장 월 / 1장 시간당) + 옆 담당자명부(P열).
function buildTargetLikeBuffer(): ArrayBuffer {
  const rows: (string | number | null)[][] = Array.from({ length: 37 }, () => Array(16).fill(null))
  rows[0][0] = '타켓금액'
  // 블록 A: 서버1대(8장) 월 (C7,D7 ...)
  rows[6][2] = 'T4'; rows[6][3] = 7_000_000
  rows[7][2] = 'V100'; rows[7][3] = 8_000_000
  // 블록 B: GPU 1장 시간당 (C37,D37)
  rows[36][2] = 'T4'; rows[36][3] = 1215.2778
  // 담당자 명부 (P7) — 가격 출처 아님
  rows[6][15] = 'NHN클라우드'
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '시간당')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

// fake AI — 블록 메타로 분기.
const fakeAI: CallAI = async (promptKey, ctx) => {
  if (promptKey === 'gpu.intake-discover') {
    return JSON.stringify({
      blocks: [
        { block_id: 'a', sheet: '시간당', bbox: 'C6:D8', role: 'price_table', unit_hint: 'month', currency_hint: 'KRW', gpu_axis_hint: 8, source_type_hint: 'own_target', confidence: 0.9 },
        { block_id: 'b', sheet: '시간당', bbox: 'C36:D37', role: 'price_table', unit_hint: 'hour', currency_hint: 'KRW', gpu_axis_hint: 1, source_type_hint: 'own_target', confidence: 0.9 },
        { block_id: 'c', sheet: '시간당', bbox: 'P7:P7', role: 'contact_directory', confidence: 0.95 },
      ],
    })
  }
  // extract — 블록 구분(gpu_axis_hint)
  if (ctx.includes('gpu_axis_hint=8')) {
    return JSON.stringify({ records: [
      { model_name: 'T4', model_addr: 'C7', price_raw: 7000000, price_addr: 'D7', term: 'on_demand', confidence: 0.9 },
      { model_name: 'V100', model_addr: 'C8', price_raw: 8000000, price_addr: 'D8', term: 'on_demand', confidence: 0.9 },
    ] })
  }
  return JSON.stringify({ records: [
    { model_name: 'T4', model_addr: 'C37', price_raw: 1215.2778, price_addr: 'D37', term: 'on_demand', confidence: 0.9 },
  ] })
}

test('엔드투엔드: 2 가격블록 추출, 명부 제외', async () => {
  const r = await orchestrateUsai(buildTargetLikeBuffer(), { callAI: fakeAI, krwPerUsd: 1500 })
  assert.equal(r.meta.priceBlocks, 2)
  // 명부(NHN)는 추출 레코드/업체로 들어오지 않음
  assert.equal(r.items.some((i) => i.model_name.includes('NHN')), false)
  assert.equal(r.items.some((i) => i.target === 'own_target'), true)
})

test('T4가 8장/1장 두 경로 모두 0.81 USD로 정규화 → 일관 → dedup 후 1건 auto', async () => {
  const r = await orchestrateUsai(buildTargetLikeBuffer(), { callAI: fakeAI, krwPerUsd: 1500 })
  const t4s = r.items.filter((i) => i.model_name === 'T4')
  assert.equal(t4s.length, 1) // 동일 정규화값 → dedup으로 1건
  assert.ok(Math.abs(t4s[0].unit_price_usd - 0.8101851) < 0.0005, `T4 ${t4s[0].unit_price_usd}`)
  assert.equal(t4s[0].needs_human, false)
})

test('6.48 버그 회귀: 8장값을 1장으로 오인식하면 불일치로 needs_human', async () => {
  // 블록 b가 8장 단가를 1장으로 잘못 추출(6.48류) → T4 그룹 불일치
  const buggyAI: CallAI = async (key, ctx) => {
    if (key === 'gpu.intake-discover') return fakeAI(key, ctx)
    if (ctx.includes('gpu_axis_hint=8')) return fakeAI(key, ctx)
    // 1장 블록이 8장 시간당값(6.48 상당, KRW 9722)을 1장으로 추출
    return JSON.stringify({ records: [
      { model_name: 'T4', model_addr: 'C37', price_raw: 9722.22, price_addr: 'D37', unit_token: 'hour', gpu_count_hint: 1, term: 'on_demand', confidence: 0.9 },
    ] })
  }
  const r = await orchestrateUsai(buildTargetLikeBuffer(), { callAI: buggyAI, krwPerUsd: 1500 })
  const t4s = r.items.filter((i) => i.model_name === 'T4')
  assert.ok(t4s.every((t) => t.needs_human), '불일치 T4는 사람 검토로')
  assert.ok(t4s.some((t) => t.verify_flags.includes('inconsistent_group')))
})
