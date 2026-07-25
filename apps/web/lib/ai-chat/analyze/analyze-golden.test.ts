// 목록 심층분석 충실도 — 골든셋 회귀평가(결정론 계약 고정).
// 대표 문서 유형이 밀도 분류·엔티티 추출·보존율에서 기대대로 동작하는지 못박아 회귀를 막는다.
// (AI 출력은 비결정적이라 고정 불가 → 결정론 지표 계약만 골든으로 잠근다.)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyDensity, extractEntities, computeRetention, computeAddedNumbers } from './retention.ts'

// ── 골든 1: 고밀도 요구사항 정본(표 + FR/NFR ID + 수치) ──
const DENSE_REQ = `## 4.6 수익화
| ID | 요구문 | 수용 기준 | 우선순위 |
|---|---|---|---|
| FR-601 | 정기 구독 결제 | PayPal REST API v2, 실패 시 3일 유예 후 다운그레이드, 재시도 3회 | P0 |
| FR-603 | Webhook 상태 동기화 | ACTIVATED/CANCELLED 수신, PAST_DUE 3일 | P0 |
| NFR-06 | 레이트리밋 | IP 초당 10요청, 무료 분당 10턴 | must |`

// ── 골든 2: 희소 계획 목록(짧은 한 줄들) ──
const SPARSE_PLAN = `- 사용자 확보 10만 명
- 글로벌 다국어 지원
- 구독 수익화 검증`

test('골든: 고밀도 정본은 dense로 분류된다', () => {
  assert.equal(classifyDensity(DENSE_REQ), 'dense')
})

test('골든: 희소 목록은 sparse로 분류된다', () => {
  assert.equal(classifyDensity(SPARSE_PLAN), 'sparse')
})

test('골든: 고밀도 정본의 핵심 ID를 모두 추출한다', () => {
  const { ids } = extractEntities(DENSE_REQ)
  for (const id of ['FR-601', 'FR-603', 'NFR-06', 'P0']) assert.ok(ids.includes(id), `${id} 누락`)
})

test('골든: 증강 결과(원문 포함)는 보존율 100%', () => {
  // augment는 원문을 그대로 담으므로 어떤 정본이든 보존율 100%가 계약이다.
  const augmented = `${DENSE_REQ}\n\n---\n\n**🔎 분석·보강**\n추가 실무 상세...`
  const r = computeRetention(DENSE_REQ, augmented)
  assert.equal(r.idKept, r.idTotal)
  assert.equal(r.numKept, r.numTotal)
  assert.equal(r.missing.length, 0)
})

test('골든: 보강이 원문에 없던 수치를 넣으면 충실도 신호로 잡힌다', () => {
  const augmented = `${DENSE_REQ}\n\n**🔎 분석·보강**\n타임아웃 30초, SLA 99.95% 권장.`
  const added = computeAddedNumbers(DENSE_REQ, augmented)
  assert.ok(added.some((n) => n.includes('30초')))
  assert.ok(added.some((n) => n.includes('99.95%')))
})
