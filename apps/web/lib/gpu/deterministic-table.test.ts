import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePivotFlat, parseHourlyProse } from './deterministic-table.ts'

// 소프트뱅크 월정액 파이프표 — 전각 ￥(GB200)·반각 ¥ 혼재. 3열 flat 복원.
const PIVOT = [
  'サービス | NVIDIA GB200 β版プラン | NVIDIA DGX H100プラン | NVIDIA DGX A100プラン',
  '月額 | ￥4,569,000 | ¥2,500,000 | ¥1,500,000',
  'AIコンピューティングシステム | NVIDIA Blackwell GPU × 4 | NVIDIA H100 Tensor Core GPU[80GB] × 8 | NVIDIA A100 Tensor Core GPU[80GB] × 8',
].join('\n')

test('파이프표 → GB200/H100/A100 flat 복원(전각 ￥도 파싱, GB200 가격≠0)', () => {
  const obs = parsePivotFlat(PIVOT)
  const h100 = obs.find((o) => o.model_name === 'H100')!
  assert.ok(h100, 'H100 복원')
  assert.equal(h100.components[0].amount, 2_500_000)
  assert.equal(h100.components[0].currency, 'JPY')
  assert.equal(h100.components[0].gpu_count, 8)
  assert.equal(h100.components[0].component_kind, 'flat')
  const gb200 = obs.find((o) => o.model_name === 'GB200')!
  assert.equal(gb200.components[0].amount, 4_569_000, '전각 ￥ GB200 가격 살아있음(≠0)')
  assert.equal(gb200.components[0].gpu_count, 4)
})

// 시간제 산문 — 파이프 아님. 기본료+종량+스토리지 3성분 회수.
const PROSE = 'サービス NVIDIA A100 時間貸しプラン 月額基本料金 30,000円 GPU利用料金（1枚あたり） 7.2円/1分 データストアストレージ（月額） 1,000円/100GB'

test('산문 시간제 → 기본료·종량·스토리지 3성분 무손실', () => {
  const o = parseHourlyProse(PROSE, 'NVIDIA A100 時間貸しプラン')!
  assert.ok(o, 'A100 시간제 복원')
  assert.equal(o.model_name, 'A100')
  const base = o.components.find((c) => c.component_kind === 'base_fee')!
  assert.equal(base.amount, 30_000); assert.equal(base.unit, 'month')  // 月額 → 주기 보존(per_account로 뭉개면 年額 유입 시 배수오차)
  const use = o.components.find((c) => c.component_kind === 'usage')!
  assert.equal(use.amount, 7.2); assert.equal(use.unit, 'minute'); assert.equal(use.gpu_count, 1)
  const stor = o.components.find((c) => c.component_kind === 'storage')!
  assert.equal(stor.amount, 10); assert.equal(stor.unit, 'per_gb')  // 1,000円/100GB → 1GB 단가 10(미정규화 시 100배 과대계상)
})

test('비-표·비-산문 입력은 [] / null', () => {
  assert.deepEqual(parsePivotFlat('그냥 텍스트'), [])
  assert.equal(parseHourlyProse('가격 없음', 'A100'), null)
})
