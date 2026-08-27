import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WINNER_MIN_INDEX, PEERS_PER_WINNER, PEER_MAX_DAYS_APART, DISCOVERY_MIN_CHANNELS,
  buildContrastSets, promoteDiscoveries, formatDiscoveryBasis,
  type DiscoverySample, type RawFinding, type FindingCluster,
} from './discovery.ts'

// 이 파일이 지키는 것: 옛 patterns.ts가 실패한 방식으로 되돌아가지 않는다.
// 옛 실패 — 근거 104건·6채널·효과 1.26배짜리를 "성공 공식"으로 승격시켰다.

const DAY = 86_400_000
function at(daysAgo: number): string {
  // 고정 기준시각 — Date.now()를 쓰면 테스트가 시간에 따라 흔들린다
  return new Date(Date.parse('2026-08-01T00:00:00Z') - daysAgo * DAY).toISOString()
}

function sample(over: Partial<DiscoverySample> & { contentId: string }): DiscoverySample {
  return {
    channelId: 'ch1',
    title: '제목',
    caption: null,
    format: 'short',
    durationSec: 45,
    publishedAt: at(0),
    thumbnailUrl: null,
    outlierIndex: 1,
    baselineN: 20,
    ...over,
  }
}

/** 떡상 1건 + 평범 3건을 같은 채널·같은 포맷·가까운 시기로 만든다 */
function channelWithWinner(ch: string, winnerId: string, index = 5): DiscoverySample[] {
  return [
    sample({ contentId: winnerId, channelId: ch, outlierIndex: index, publishedAt: at(10) }),
    sample({ contentId: `${ch}-p1`, channelId: ch, outlierIndex: 1.0, publishedAt: at(12) }),
    sample({ contentId: `${ch}-p2`, channelId: ch, outlierIndex: 0.9, publishedAt: at(14) }),
    sample({ contentId: `${ch}-p3`, channelId: ch, outlierIndex: 1.1, publishedAt: at(16) }),
  ]
}

test('떡상 1건에 같은 채널의 평범 3건이 대조군으로 붙는다', () => {
  const sets = buildContrastSets(channelWithWinner('ch1', 'w1'))
  assert.equal(sets.length, 1)
  assert.equal(sets[0].winner.contentId, 'w1')
  assert.equal(sets[0].peers.length, PEERS_PER_WINNER)
})

test('대조군이 모자라면 그 떡상은 설명하지 않는다 — 근거 없이 말하지 않는다', () => {
  const sets = buildContrastSets([
    sample({ contentId: 'w1', outlierIndex: 8 }),
    sample({ contentId: 'p1', outlierIndex: 1.0 }),
    sample({ contentId: 'p2', outlierIndex: 1.0 }),
    // 평범이 2건뿐 — 3건을 못 채운다
  ])
  assert.equal(sets.length, 0)
})

test('포맷이 다른 것은 대조군이 될 수 없다 — 숏폼과 롱폼은 다른 게임이다', () => {
  const sets = buildContrastSets([
    sample({ contentId: 'w1', outlierIndex: 6, format: 'short' }),
    sample({ contentId: 'p1', outlierIndex: 1.0, format: 'long' }),
    sample({ contentId: 'p2', outlierIndex: 1.0, format: 'long' }),
    sample({ contentId: 'p3', outlierIndex: 1.0, format: 'long' }),
  ])
  assert.equal(sets.length, 0)
})

test('다른 채널의 콘텐츠는 대조군이 될 수 없다 — 규모가 이유로 섞인다', () => {
  const sets = buildContrastSets([
    sample({ contentId: 'w1', channelId: 'A', outlierIndex: 6 }),
    sample({ contentId: 'p1', channelId: 'B', outlierIndex: 1.0 }),
    sample({ contentId: 'p2', channelId: 'B', outlierIndex: 1.0 }),
    sample({ contentId: 'p3', channelId: 'B', outlierIndex: 1.0 }),
  ])
  assert.equal(sets.length, 0)
})

test('시간이 너무 벌어진 콘텐츠는 대조군에서 빠진다', () => {
  const sets = buildContrastSets([
    sample({ contentId: 'w1', outlierIndex: 6, publishedAt: at(0) }),
    sample({ contentId: 'p1', outlierIndex: 1.0, publishedAt: at(2) }),
    sample({ contentId: 'p2', outlierIndex: 1.0, publishedAt: at(4) }),
    sample({ contentId: 'p3', outlierIndex: 1.0, publishedAt: at(PEER_MAX_DAYS_APART + 30) }),
  ])
  assert.equal(sets.length, 0)
})

test('평소 수준(1배 언저리)은 떡상으로 취급하지 않는다', () => {
  const sets = buildContrastSets(
    channelWithWinner('ch1', 'w1', WINNER_MIN_INDEX - 0.1),
  )
  assert.equal(sets.length, 0)
})

test('배수가 큰 떡상이 먼저 온다 — AI 예산이 한정될 때 설명 가치 순', () => {
  const sets = buildContrastSets([
    ...channelWithWinner('A', 'low', 3),
    ...channelWithWinner('B', 'high', 40),
  ])
  assert.equal(sets[0].winner.contentId, 'high')
})

// ── 승격 판정 ─────────────────────────────────────────────

function findings(pairs: [string, string][]): RawFinding[] {
  return pairs.map(([contentId, channelId]) => ({
    contentId, channelId, statement: '실패담으로 시작한다', observation: '첫 3초에 실패 언급',
  }))
}

test('서로 다른 채널 3곳에서 반복되면 공식으로 승격한다', () => {
  const f = findings([['c1', 'A'], ['c2', 'B'], ['c3', 'C']])
  const clusters: FindingCluster[] = [{ statement: '실패담으로 시작한다', contentIds: ['c1', 'c2', 'c3'] }]
  const r = promoteDiscoveries(clusters, f)

  assert.equal(r.promoted.length, 1)
  assert.equal(r.promoted[0].channelCount, 3)
  assert.equal(r.promoted[0].evidenceCount, 3)
})

test('한 채널에서만 반복된 것은 그 채널의 습관이지 공식이 아니다', () => {
  // 옛 시스템이 놓친 자리 — 근거 수만 보면 통과시킬 뻔한 모양이다
  const f = findings([['c1', 'A'], ['c2', 'A'], ['c3', 'A'], ['c4', 'A'], ['c5', 'A']])
  const clusters: FindingCluster[] = [
    { statement: '실패담으로 시작한다', contentIds: ['c1', 'c2', 'c3', 'c4', 'c5'] },
  ]
  const r = promoteDiscoveries(clusters, f)

  assert.equal(r.promoted.length, 0)
  assert.equal(r.rejected.length, 1)
  assert.match(r.rejected[0].reason, /채널/)
})

test('두 채널까지는 아직 승격하지 않는다', () => {
  const f = findings([['c1', 'A'], ['c2', 'B'], ['c3', 'B']])
  const clusters: FindingCluster[] = [{ statement: 'x', contentIds: ['c1', 'c2', 'c3'] }]
  const r = promoteDiscoveries(clusters, f)
  assert.equal(r.promoted.length, 0)
  assert.equal(r.rejected[0].channelCount, DISCOVERY_MIN_CHANNELS - 1)
})

test('탈락한 군집도 이유와 함께 남는다 — 조용히 버리지 않는다', () => {
  const f = findings([['c1', 'A']])
  const r = promoteDiscoveries([{ statement: '한 번뿐인 관찰', contentIds: ['c1'] }], f)
  assert.equal(r.rejected.length, 1)
  assert.equal(r.rejected[0].statement, '한 번뿐인 관찰')
  assert.ok(r.rejected[0].reason.length > 0)
})

test('같은 콘텐츠가 중복으로 들어와도 근거 수가 부풀지 않는다', () => {
  const f = findings([['c1', 'A'], ['c2', 'B'], ['c3', 'C']])
  const clusters: FindingCluster[] = [
    { statement: 'x', contentIds: ['c1', 'c1', 'c2', 'c2', 'c3'] },
  ]
  const r = promoteDiscoveries(clusters, f)
  assert.equal(r.promoted[0].evidenceCount, 3)
  assert.equal(r.promoted[0].channelCount, 3)
})

test('널리 반복된 것이 위로 온다', () => {
  const f: RawFinding[] = [
    ...findings([['a1', 'A'], ['a2', 'B'], ['a3', 'C']]),
    ...findings([['b1', 'A'], ['b2', 'B'], ['b3', 'C'], ['b4', 'D'], ['b5', 'E']]),
  ]
  const r = promoteDiscoveries([
    { statement: '좁게 반복', contentIds: ['a1', 'a2', 'a3'] },
    { statement: '널리 반복', contentIds: ['b1', 'b2', 'b3', 'b4', 'b5'] },
  ], f)
  assert.equal(r.promoted[0].statement, '널리 반복')
})

test('근거 표기는 개수와 채널 수를 반드시 함께 낸다', () => {
  assert.equal(formatDiscoveryBasis(7, 4), '근거 7건 · 채널 4곳')
})
