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

// [URL 실화면 회귀고정 v0.7.354] 전체 페이지에서 모델 자동감지.
//   사고: 앵커를 "키워드 첫 매치"로 잡아, 특장점 섹션의 '従量課金'·'時間貸し'가 먼저 걸리고 그 부근엔
//   모델명이 없어 감지 실패 → null → 성분 0건(URL로 넣으면 시간제 요금이 통째로 유실).
//   → 앵커는 **실제 금액이 붙은 위치**여야 한다. 키워드만 있고 금액이 없는 앞 구간에 속으면 안 된다.
test('URL 회귀 — 키워드가 앞서 나와도 금액 위치 기준으로 모델을 찾는다', () => {
  const FULL = [
    '特長 大規模学習に適した AIコンピューティングシステムを専有利用',
    '分単位で利用できる従量課金サービス',            // ← 키워드 선행(모델 없음). 여기 속으면 실패.
    'NVIDIA DGX A100 時間貸しプラン A100 GPUを1枚から、1分単位で利用できます。',
    'サービス NVIDIA A100 時間貸しプラン 月額基本料金 30,000円 GPU利用料金（1枚あたり） 7.2円/1分 データストアストレージ（月額） 1,000円/100GB',
  ].join(' ')
  const r = parseHourlyProse(FULL)   // 모델 미지정 → 자동감지
  assert.ok(r != null, '전체 페이지에서도 감지돼야 함(null이면 성분 통째 유실)')
  assert.equal(r!.model_name, 'A100')
  assert.equal(r!.components.length, 3, '기본료·종량·스토리지')
})

test('URL 회귀 — 금액이 아예 없으면 여전히 null(오탐 방지)', () => {
  const NO_PRICE = '分単位で利用できる従量課金サービス NVIDIA DGX A100 時間貸しプラン 詳細はお問い合わせください。'
  assert.equal(parseHourlyProse(NO_PRICE), null)
})
