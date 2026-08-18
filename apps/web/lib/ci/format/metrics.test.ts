import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatOutlier, formatPercentile, formatLift, formatConfidence,
  formatComparability, formatCompleteness, formatMissingFields, formatBasis,
  judgeConfidence, allowsAssertiveNarrative,
  OUTLIER_MIN_BASELINE, PERCENTILE_MIN_POPULATION,
} from './metrics.ts'

test('비교 이력이 8개 미만이면 배수를 표시하지 않는다', () => {
  assert.equal(formatOutlier(8.4, OUTLIER_MIN_BASELINE - 1), null)
  assert.equal(formatOutlier(8.4, 0), null)
})

test('비교 이력이 충분하면 소수 1자리 문장으로 표기한다', () => {
  assert.equal(formatOutlier(8.44, 20), '평소 대비 8.4배')
  assert.equal(formatOutlier(12, 8), '평소 대비 12.0배')
})

test('배수가 없거나 비정상이면 null', () => {
  assert.equal(formatOutlier(null, 30), null)
  assert.equal(formatOutlier(NaN, 30), null)
  assert.equal(formatOutlier(0, 30), null)
})

test('모집단이 30 미만이면 백분위를 표시하지 않는다', () => {
  assert.equal(formatPercentile(3, PERCENTILE_MIN_POPULATION - 1), null)
  assert.equal(formatPercentile(3, 340), '같은 주제 상위 3%')
})

test('백분위 0%는 오해를 부르므로 최소 1%로 올린다', () => {
  assert.equal(formatPercentile(0.2, 500), '같은 주제 상위 1%')
})

test('성공 공식은 근거 20개·채널 5곳 미만이면 공식으로 노출하지 않는다', () => {
  assert.equal(formatLift(2.1, 19, 7), null)
  assert.equal(formatLift(2.1, 32, 4), null)
})

test('성공 공식 표기에는 근거 개수와 채널 수가 반드시 병기된다', () => {
  const s = formatLift(2.14, 32, 7)
  assert.equal(s, '이 공식 적용 시 중앙값 2.1배 (근거 32개, 채널 7곳)')
  assert.ok(s!.includes('근거 32개'))
  assert.ok(s!.includes('채널 7곳'))
})

test('신뢰도·비교가능성은 한국어 문장으로 번역된다', () => {
  assert.equal(formatConfidence('high'), '근거 충분')
  assert.equal(formatConfidence('medium'), '관찰 중')
  assert.equal(formatConfidence('insufficient'), '데이터 부족')
  assert.equal(formatComparability('A'), '조회수 비교 가능')
  assert.equal(formatComparability('B'), '참여로만 비교')
  assert.equal(formatComparability('C'), '비교 불가')
  assert.equal(formatComparability(null), '비교 기준 미확인')
})

test('완전도가 0.8 이상이면 배지를 달지 않는다', () => {
  assert.equal(formatCompleteness(0.8), null)
  assert.equal(formatCompleteness(1), null)
  assert.equal(formatCompleteness(0.79), '일부만 수집됨')
  assert.equal(formatCompleteness(null), '수집 상태 미확인')
})

test('수치에는 기간 창과 표본 수를 병기한다', () => {
  assert.equal(formatBasis(28, 42), '28일 기준, 표본 42건')
})

test('신뢰도 판정은 표본·완전도·비교등급을 모두 본다', () => {
  assert.equal(judgeConfidence({ baselineN: 20, completeness: 0.9, comparability: 'A' }), 'high')
  // 비교등급이 A가 아니면 high가 될 수 없다
  assert.equal(judgeConfidence({ baselineN: 50, completeness: 1, comparability: 'B' }), 'medium')
  assert.equal(judgeConfidence({ baselineN: 8, completeness: 0.7, comparability: 'C' }), 'medium')
  assert.equal(judgeConfidence({ baselineN: 7, completeness: 1, comparability: 'A' }), 'insufficient')
  assert.equal(judgeConfidence({ baselineN: 30, completeness: 0.6, comparability: 'A' }), 'insufficient')
})

test('근거가 부족하면 AI 단정 서술을 허용하지 않는다', () => {
  assert.equal(allowsAssertiveNarrative('insufficient'), false)
  assert.equal(allowsAssertiveNarrative('medium'), true)
  assert.equal(allowsAssertiveNarrative('high'), true)
})

// ── 미확보 항목 표기 ──────────────────────────────────────────────────
//
// 왜 잠그나: 예전 배지는 완전도 숫자만 보고 '일부만 수집됨'을 달았다. DB 기본값이 0이라
// **아직 수집을 시작도 안 한 행**이 전부 그 배지를 달았고(실측 v0.7.565), 상태 배지의
// 'partial' 라벨과 문구까지 같아 칩이 두 개 겹쳤다. 지금은 축을 나눠 이 함수가
// **무엇이 비었는지**만 말한다.

test('미확보 항목이 없으면 배지를 달지 않는다', () => {
  assert.equal(formatMissingFields([]), null)
  assert.equal(formatMissingFields(null), null)
  assert.equal(formatMissingFields(undefined), null)
})

test('컬럼명이 아니라 사람 말로 적는다 — published_at은 사용자에게 아무 뜻이 없다', () => {
  assert.equal(formatMissingFields(['views', 'likes']), '조회수·좋아요 없음')
  assert.equal(formatMissingFields(['published_at']), '게시일 없음')
})

test('많으면 접는다 — 배지 하나가 행 높이를 무너뜨리지 않게', () => {
  // 실측 TikTok 행: published_at·views·likes·comments 4개
  assert.equal(
    formatMissingFields(['published_at', 'views', 'likes', 'comments']),
    '게시일·조회수·좋아요 외 1개 없음',
  )
})

test('모르는 컬럼명은 지어내지 않고 그대로 보여준다', () => {
  assert.equal(formatMissingFields(['weird_new_field']), 'weird_new_field 없음')
})
