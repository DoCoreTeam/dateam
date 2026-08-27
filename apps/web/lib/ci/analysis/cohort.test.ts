import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_COHORT_SAMPLE, resolveSizeBand, sizeBandLabel, cohortKey, describeCohort,
  groupIntoCohorts, countUncomparable, formatLabel,
  type CohortMember,
} from './cohort.ts'

// 이 파일이 지키는 것: 비교군이 틀리면 그 위의 모든 숫자가 틀린다.
// 실측 사고(2026-08-27) — '음식' 1,024건 안에 쯔양(1,340만)과 인영인영(19.8만)이 함께 있었다.

test('쯔양(1,340만)과 인영인영(19.8만)은 다른 규모대로 갈린다', () => {
  assert.equal(resolveSizeBand(13_400_000), 'large')
  assert.equal(resolveSizeBand(198_000), 'mid')
  assert.notEqual(resolveSizeBand(13_400_000), resolveSizeBand(198_000))
})

test('규모대 경계는 하한 포함·상한 미포함이다', () => {
  assert.equal(resolveSizeBand(9_999), 'nano')
  assert.equal(resolveSizeBand(10_000), 'small')
  assert.equal(resolveSizeBand(99_999), 'small')
  assert.equal(resolveSizeBand(100_000), 'mid')
  assert.equal(resolveSizeBand(999_999), 'mid')
  assert.equal(resolveSizeBand(1_000_000), 'large')
})

test('구독자를 모르는 채널은 최소 구간으로 떨어지지 않고 null이다', () => {
  // 모르는 것을 nano로 넣으면 미확보 채널이 그 구간 통계를 오염시킨다
  assert.equal(resolveSizeBand(null), null)
  assert.equal(resolveSizeBand(undefined), null)
  assert.equal(resolveSizeBand(Number.NaN), null)
  assert.equal(resolveSizeBand(-1), null)
})

test('축이 하나라도 미확인이면 코호트 키를 만들지 않는다', () => {
  const full = { topicId: 't1', format: 'short', sizeBand: 'mid' as const, windowDays: 28 }
  assert.equal(cohortKey(full), 't1|short|mid|28')

  assert.equal(cohortKey({ ...full, topicId: null }), null)
  assert.equal(cohortKey({ ...full, format: null }), null)
  assert.equal(cohortKey({ ...full, sizeBand: null }), null)
  assert.equal(cohortKey({ ...full, windowDays: 0 }), null)
})

test('같은 주제여도 규모대가 다르면 다른 코호트다', () => {
  const a = cohortKey({ topicId: 't1', format: 'short', sizeBand: 'large', windowDays: 28 })
  const b = cohortKey({ topicId: 't1', format: 'short', sizeBand: 'mid', windowDays: 28 })
  assert.notEqual(a, b)
})

test('같은 규모대여도 포맷이 다르면 다른 코호트다', () => {
  const a = cohortKey({ topicId: 't1', format: 'short', sizeBand: 'mid', windowDays: 28 })
  const b = cohortKey({ topicId: 't1', format: 'long', sizeBand: 'mid', windowDays: 28 })
  assert.notEqual(a, b)
})

function member(over: Partial<CohortMember> & { contentId: string }): CohortMember {
  return {
    channelId: 'ch1',
    outlierIndex: 1,
    axes: { topicId: 't1', format: 'short', sizeBand: 'mid', windowDays: 28 },
    ...over,
  }
}

test('표본이 8건 미만인 코호트는 숫자를 낼 수 없다고 표시된다', () => {
  const few = Array.from({ length: MIN_COHORT_SAMPLE - 1 }, (_, i) => member({ contentId: `c${i}` }))
  const [g] = groupIntoCohorts(few)
  assert.equal(g.members.length, MIN_COHORT_SAMPLE - 1)
  assert.equal(g.usable, false)
})

test('표본이 8건 이상이면 사용 가능해진다', () => {
  const enough = Array.from({ length: MIN_COHORT_SAMPLE }, (_, i) => member({ contentId: `c${i}` }))
  const [g] = groupIntoCohorts(enough)
  assert.equal(g.usable, true)
})

test('코호트는 서로 다른 채널 수를 센다 — 한 채널짜리는 시장이 아니다', () => {
  const items = [
    member({ contentId: 'a', channelId: 'ch1' }),
    member({ contentId: 'b', channelId: 'ch1' }),
    member({ contentId: 'c', channelId: 'ch2' }),
    member({ contentId: 'd', channelId: null }),
  ]
  const [g] = groupIntoCohorts(items)
  assert.equal(g.channelCount, 2)
})

test('축이 다른 것들은 서로 다른 그룹으로 갈라진다', () => {
  const groups = groupIntoCohorts([
    member({ contentId: 'a' }),
    member({ contentId: 'b', axes: { topicId: 't1', format: 'long', sizeBand: 'mid', windowDays: 28 } }),
    member({ contentId: 'c', axes: { topicId: 't2', format: 'short', sizeBand: 'mid', windowDays: 28 } }),
  ])
  assert.equal(groups.length, 3)
})

test('비교 불가 건수를 따로 셀 수 있다 — 조용히 빠지면 전수를 봤다고 오해한다', () => {
  const items = [
    member({ contentId: 'a' }),
    member({ contentId: 'b', axes: { topicId: null, format: 'short', sizeBand: 'mid', windowDays: 28 } }),
    member({ contentId: 'c', axes: { topicId: 't1', format: 'short', sizeBand: null, windowDays: 28 } }),
  ]
  assert.equal(countUncomparable(items), 2)
  assert.equal(groupIntoCohorts(items).length, 1)
})

test('무엇끼리의 비교인지 사람 말로 설명한다', () => {
  const s = describeCohort(
    { topicId: 't1', format: 'short', sizeBand: 'mid', windowDays: 28 },
    '자취요리',
  )
  assert.equal(s, '자취요리 주제 · 숏폼 · 구독 10만~100만 · 최근 28일')
})

test('주제 이름을 모를 때도 문장이 성립한다', () => {
  const s = describeCohort({ topicId: 't1', format: 'long', sizeBand: 'large', windowDays: 90 })
  assert.equal(s, '같은 주제 · 롱폼 · 구독 100만 이상 · 최근 90일')
})

test('미확인 축은 라벨로도 미확인이라고 말한다 — 숨기지 않는다', () => {
  assert.equal(sizeBandLabel(null), '규모 미확인')
  assert.equal(formatLabel(null), '포맷 미확인')
})
