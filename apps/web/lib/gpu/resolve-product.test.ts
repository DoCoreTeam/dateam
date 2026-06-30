import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveProductId, heldReasonMessage } from './resolve-product.ts'

// 읽기전용 가짜 DB — db.from(t).select(c).is('deleted_at', null) → { data: rows }
interface Row { id: string; model_name: string; memory: string | null; gpu_count: number | null }
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

test('heldReasonMessage — 사유별 안내 문구', () => {
  assert.match(heldReasonMessage('no_model', 'MI300X'), /카탈로그에 없습니다.*스펙 관리/)
  assert.match(heldReasonMessage('no_variant', 'H100', 8), /8장 구성이 없습니다/)
  assert.match(heldReasonMessage('ambiguous_variant', 'RTX 3060'), /메모리로 특정할 수 없습니다/)
})
