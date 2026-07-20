import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconstructPivot } from './pivot-reconstruct.ts'

// 소프트뱅크 세로형 비교표(플랜=열) — 전사가 속성행으로 흩어 담은 걸 열별로 복원.
test('소프트뱅크 피벗표 → H100 ¥2,500,000/월·8장 · A100 ¥1,500,000 복원', () => {
  const rows = [
    { raw_label: 'サービス', cells: ['NVIDIA GB200 β版プラン', 'NVIDIA DGX H100プラン', 'NVIDIA DGX A100プラン'] },
    { raw_label: '月額', cells: ['¥4,569,000', '¥2,500,000', '¥1,500,000'] },
    { raw_label: 'AIコンピューティングシステム', cells: ['NVIDIA Blackwell GPU × 4', 'NVIDIA H100 Tensor Core GPU[80GB] × 8', 'NVIDIA A100 Tensor Core GPU[80GB] × 8'] },
  ]
  const obs = reconstructPivot(rows)
  // GB200/H100/A100 3열 복원(모델 신호 있는 열)
  const h100 = obs.find((o) => /h100/i.test(o.model_name))!
  assert.ok(h100, 'H100 열 복원')
  assert.equal(h100.amount, 2_500_000)
  assert.equal(h100.currency, 'JPY')
  assert.equal(h100.pricing_unit, 'month')  // 月額
  assert.equal(h100.gpu_count, 8)            // × 8
  const a100 = obs.find((o) => /a100/i.test(o.model_name))!
  assert.equal(a100.amount, 1_500_000)
  assert.equal(a100.gpu_count, 8)
})

test('가격/모델 행이 없으면 [] (비-피벗 입력은 기존 경로 유지)', () => {
  assert.deepEqual(reconstructPivot([{ raw_label: 'H100', price_text: '$2.10/hr', cells: [] }]), [])
  assert.deepEqual(reconstructPivot([]), [])
  assert.deepEqual(reconstructPivot(undefined as never), [])
})
