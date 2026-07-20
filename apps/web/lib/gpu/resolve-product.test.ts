import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveProductId, heldReasonMessage } from './resolve-product.ts'

// 읽기전용 가짜 DB — db.from(t).select(c).is('deleted_at', null) → { data: rows }
interface Row { id: string; model_name: string; memory: string | null; gpu_count: number | null; strategic_price_krw?: number | null; form_factor?: string | null }
function fakeDb(rows: Row[]) {
  return {
    from() {
      const chain = {
        select() { return chain },
        is() { return Promise.resolve({ data: rows }) },
      }
      return chain
    },
  }
}

const CATALOG: Row[] = [
  // B200 — count별 사다리, ×1은 메모리 180GB 하나뿐(드리프트 흡수 대상)
  { id: 'b200-1', model_name: 'B200', memory: '180GB', gpu_count: 1 },
  { id: 'b200-2', model_name: 'B200', memory: '360GB', gpu_count: 2 },
  // RTX 3060 — 같은 ×1에 메모리가 진짜 다른 별개 SKU(8GB vs 12GB) → 잘못 병합 금지 대상
  { id: '3060-8', model_name: 'RTX 3060', memory: '8GB', gpu_count: 1 },
  { id: '3060-12', model_name: 'RTX 3060', memory: '12GB', gpu_count: 1 },
  // H100 — ×1 단일
  { id: 'h100-1', model_name: 'H100', memory: '80GB', gpu_count: 1 },
]

test('verbose 소스명을 기존 단축 모델 ×1로 해소 (memory 결측)', async () => {
  const r = await resolveProductId(fakeDb(CATALOG), { modelName: 'NVIDIA HGX B200' })
  assert.deepEqual(r, { productId: 'b200-1', matched: 'single_variant' })
})

test('메모리 드리프트 흡수 — 소스 192GB여도 ×1 단일변형(180GB)에 결합', async () => {
  const r = await resolveProductId(fakeDb(CATALOG), { modelName: 'B200', gpuCount: 1, memory: '192GB' })
  assert.deepEqual(r, { productId: 'b200-1', matched: 'single_variant' })
})

test('메모리 정확매칭 — 같은 장수 다중변형 중 메모리로 특정', async () => {
  const r = await resolveProductId(fakeDb(CATALOG), { modelName: 'RTX 3060', gpuCount: 1, memory: '12GB' })
  assert.deepEqual(r, { productId: '3060-12', matched: 'exact_memory' })
})

test('잘못 병합 차단 — 같은 장수 다중 메모리인데 특정 불가 → ambiguous 보류(메모리 후보 동봉)', async () => {
  // 보류하되 사용자가 그 자리서 고를 수 있게 메모리 변형 후보를 함께 반환(confirm-review-item 인카드 선택).
  const candidates = [
    { id: '3060-8', memory: '8GB', gpuCount: 1 },
    { id: '3060-12', memory: '12GB', gpuCount: 1 },
  ]
  const noMem = await resolveProductId(fakeDb(CATALOG), { modelName: 'RTX 3060', gpuCount: 1 })
  assert.deepEqual(noMem, { held: true, reason: 'ambiguous_variant', candidates })
  const wrongMem = await resolveProductId(fakeDb(CATALOG), { modelName: 'RTX 3060', gpuCount: 1, memory: '10GB' })
  assert.deepEqual(wrongMem, { held: true, reason: 'ambiguous_variant', candidates })
})

// 완전중복 오염 카탈로그 — (model,memory,gpu_count) 동일 행 여럿(T4 실사고). V100은 진짜 다변형.
const DUP: Row[] = [
  { id: 't4-a', model_name: 'T4', memory: '16GB', gpu_count: 1, strategic_price_krw: null },
  { id: 't4-b', model_name: 'T4', memory: '16GB', gpu_count: 1, strategic_price_krw: 1254 }, // 가격 보유
  { id: 't4-c', model_name: 'T4', memory: '16GB', gpu_count: 1, strategic_price_krw: null },
  { id: 'v100-16', model_name: 'V100', memory: '16GB', gpu_count: 1, strategic_price_krw: null },
  { id: 'v100-32', model_name: 'V100', memory: '32GB', gpu_count: 1, strategic_price_krw: 1434 },
]

test('완전중복 행(같은 메모리 여러 행) → 대표 1개로 자동확정, 가격 보유행 우선', async () => {
  const r = await resolveProductId(fakeDb(DUP), { modelName: 'T4', gpuCount: 1 })
  assert.deepEqual(r, { productId: 't4-b', matched: 'single_variant' })
})

test('완전중복 + 메모리 지정 → 대표 1개(가격 보유행)로 확정', async () => {
  const r = await resolveProductId(fakeDb(DUP), { modelName: 'T4', gpuCount: 1, memory: '16GB' })
  assert.deepEqual(r, { productId: 't4-b', matched: 'exact_memory' })
})

test('진짜 다변형(V100 16 vs 32)은 여전히 ambiguous — 메모리별 대표 후보만', async () => {
  const r = await resolveProductId(fakeDb(DUP), { modelName: 'V100', gpuCount: 1 })
  assert.deepEqual(r, { held: true, reason: 'ambiguous_variant', candidates: [
    { id: 'v100-16', memory: '16GB', gpuCount: 1 },
    { id: 'v100-32', memory: '32GB', gpuCount: 1 },
  ] })
})

test('모델 없음 → no_model 보류 (깡통 생성 금지)', async () => {
  const r = await resolveProductId(fakeDb(CATALOG), { modelName: 'MI300X' })
  assert.deepEqual(r, { held: true, reason: 'no_model' })
  const empty = await resolveProductId(fakeDb([]), { modelName: 'B200' })
  assert.deepEqual(empty, { held: true, reason: 'no_model' })
})

test('모델은 있으나 그 장수 구성 없음 → no_variant 보류', async () => {
  const r = await resolveProductId(fakeDb(CATALOG), { modelName: 'H100', gpuCount: 8 })
  assert.deepEqual(r, { held: true, reason: 'no_variant' })
})

test('gpuCount 기본값 1 — 경쟁사 on-demand', async () => {
  const r = await resolveProductId(fakeDb(CATALOG), { modelName: 'H100' })
  assert.deepEqual(r, { productId: 'h100-1', matched: 'single_variant' })
})

test('빈 모델명 → no_model', async () => {
  const r = await resolveProductId(fakeDb(CATALOG), { modelName: '   ' })
  assert.deepEqual(r, { held: true, reason: 'no_model' })
})

// P5 — 폼팩터 축 분리 카탈로그(마이그166 백필과 동일 형상): 폼팩터 없는 bare 모델과
// SXM/PCIe 변형이 각각 별개 행으로 공존.
const FORM_FACTOR_CATALOG: Row[] = [
  { id: 'a100-sxm', model_name: 'A100 SXM', memory: '80GB', gpu_count: 1, form_factor: 'SXM' },
  { id: 'a100-pcie', model_name: 'A100 PCIe', memory: '80GB', gpu_count: 1, form_factor: 'PCIe' },
  { id: 'h100-nvl', model_name: 'H100 NVL', memory: '94GB', gpu_count: 1, form_factor: 'NVL' },
  { id: 'l40s', model_name: 'L40S', memory: '48GB', gpu_count: 1, form_factor: null },
]

test('P5 — 세대숫자 변형(A100 SXM4) ↔ 카탈로그 A100 SXM 매칭 성공', async () => {
  const r = await resolveProductId(fakeDb(FORM_FACTOR_CATALOG), { modelName: 'A100 SXM4', gpuCount: 1 })
  assert.deepEqual(r, { productId: 'a100-sxm', matched: 'single_variant' })
})

test('P5 — 폼팩터 다른 제품(A100 PCIe)은 A100 SXM과 불일치(별개 매칭)', async () => {
  const r = await resolveProductId(fakeDb(FORM_FACTOR_CATALOG), { modelName: 'A100 PCIe', gpuCount: 1 })
  assert.deepEqual(r, { productId: 'a100-pcie', matched: 'single_variant' })
  // 다른 폼팩터끼리 서로의 id로 오매칭되지 않았는지 명시적으로 확인
  assert.notEqual((r as { productId: string }).productId, 'a100-sxm')
})

test('P5 — 세대숫자 변형(H100 SXM5)도 동일 축 분리로 매칭(카탈로그에 SXM5는 없고 core+SXM만 있음)', async () => {
  const CATALOG_H100: Row[] = [
    { id: 'h100-sxm', model_name: 'H100 SXM', memory: '80GB', gpu_count: 1, form_factor: 'SXM' },
  ]
  const r = await resolveProductId(fakeDb(CATALOG_H100), { modelName: 'H100 SXM5', gpuCount: 1 })
  assert.deepEqual(r, { productId: 'h100-sxm', matched: 'single_variant' })
})

test('P5 — 폼팩터 없는 모델(L40S)은 기존 경로 그대로 정상 매칭(회귀 0)', async () => {
  const r = await resolveProductId(fakeDb(FORM_FACTOR_CATALOG), { modelName: 'L40S', gpuCount: 1 })
  assert.deepEqual(r, { productId: 'l40s', matched: 'single_variant' })
})

test('P5 — 전체문자열 일치(1차)가 성공하면 폼팩터 폴백을 타지 않음(회귀 0)', async () => {
  // "A100 SXM" 그대로 입력 → 1차 경로(coreModelKey 전체일치)로 바로 매칭, 폴백 관여 불필요
  const r = await resolveProductId(fakeDb(FORM_FACTOR_CATALOG), { modelName: 'A100 SXM', gpuCount: 1 })
  assert.deepEqual(r, { productId: 'a100-sxm', matched: 'single_variant' })
})

test('P5 — 카탈로그에 그 폼팩터 변형이 전혀 없으면 no_variant 보류(깡통 생성 금지)', async () => {
  // A100 core는 카탈로그에 있으나(SXM·PCIe) NVL 변형은 없음 → 오매칭 대신 보류
  const r = await resolveProductId(fakeDb(FORM_FACTOR_CATALOG), { modelName: 'A100 NVL', gpuCount: 1 })
  assert.deepEqual(r, { held: true, reason: 'no_variant' })
})

test('P5 — 입력에 폼팩터 토큰이 없고 core도 카탈로그에 없으면 여전히 no_model(폴백 미관여)', async () => {
  const r = await resolveProductId(fakeDb(FORM_FACTOR_CATALOG), { modelName: 'MI300X' })
  assert.deepEqual(r, { held: true, reason: 'no_model' })
})

test('heldReasonMessage — 사유별 안내 문구', () => {
  assert.match(heldReasonMessage('no_model', 'MI300X'), /카탈로그에 없습니다.*스펙 관리/)
  assert.match(heldReasonMessage('no_variant', 'H100', 8), /8장 구성이 없습니다/)
  assert.match(heldReasonMessage('ambiguous_variant', 'RTX 3060'), /메모리로 특정할 수 없습니다/)
})
