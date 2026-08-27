import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WINNER_MIN_INDEX, PEERS_PER_WINNER, PEER_MAX_DAYS_APART, DISCOVERY_MIN_CHANNELS,
  buildContrastSets, promoteDiscoveries, formatDiscoveryBasis, clusterByOverlap, mergeClusters, pickRepresentative,
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

// ── 표본 다양성 ────────────────────────────────────────────
// 실측 사고(2026-08-27): 배수 내림차순으로만 자르자 떡상 354건인 한 채널이
// 상위 12개를 독점했고, 발견 11건이 전부 "1개 채널에서만"으로 탈락해 승격 0이 됐다.
// 승격 조건이 "서로 다른 채널 3곳"인데 표본이 한 채널이면 구조적으로 아무것도 못 올린다.

test('★ 한 채널이 표본을 독점하지 않는다 — 승격 조건을 스스로 못 채우던 자리', () => {
  const big = Array.from({ length: 10 }, (_, i) =>
    channelWithWinner('big', `big-w${i}`, 40 - i)).flat()
  const sets = buildContrastSets([
    ...big,
    ...channelWithWinner('B', 'b1', 3),
    ...channelWithWinner('C', 'c1', 2.5),
  ])
  const head = sets.slice(0, 3)
  const channels = new Set(head.map((s) => s.winner.channelId))
  assert.equal(channels.size, 3, `앞 3개가 ${channels.size}개 채널 — 한 채널이 독점했다`)
})

test('채널 안에서는 배수 순서가 유지된다 — 설명 가치가 큰 것이 먼저다', () => {
  const sets = buildContrastSets([
    ...channelWithWinner('A', 'a-low', 3),
    ...channelWithWinner('A', 'a-high', 9),
    ...channelWithWinner('B', 'b1', 5),
  ])
  const aOrder = sets.filter((s) => s.winner.channelId === 'A').map((s) => s.winner.contentId)
  assert.deepEqual(aOrder, ['a-high', 'a-low'])
})

test('배수가 가장 높은 채널이 첫 자리를 가져간다', () => {
  const sets = buildContrastSets([
    ...channelWithWinner('low', 'l1', 3),
    ...channelWithWinner('top', 't1', 30),
  ])
  assert.equal(sets[0].winner.channelId, 'top')
})

test('재배열이 항목을 잃거나 더하지 않는다', () => {
  const sets = buildContrastSets([
    ...channelWithWinner('A', 'a1', 5), ...channelWithWinner('A', 'a2', 4),
    ...channelWithWinner('B', 'b1', 6), ...channelWithWinner('C', 'c1', 2.2),
  ])
  assert.equal(sets.length, 4)
  assert.equal(new Set(sets.map((s) => s.winner.contentId)).size, 4)
})

// ── 묶기 폴백 ──────────────────────────────────────────────
// 실측 사고(2026-08-27): AI 묶기는 파이프라인의 **마지막 호출**이라 그때쯤 할당량이 바닥난다.
// 실패하면 각 문장이 홀로 남고, 홀로 남으면 채널이 1곳이라 전부 탈락한다 —
// 발견 12건을 만들어 놓고 화면엔 0건이 뜬다. 아래 문장들은 그때 실제로 나온 것이다.

const REAL_FINDINGS: [string, string, string][] = [
  ['c1', 'A', '대중적 인지도가 높은 유명인의 이름을 제목에 직접 언급하여 호기심을 유발한다.'],
  ['c2', 'B', '대중적 화제성이 높은 유명인의 이름을 제목에 배치하여 호기심을 극대화했다.'],
  ['c3', 'C', '대중적 인지도가 높은 유명인의 이름을 제목에 명시하여 호기심을 자극한다.'],
  ['c4', 'D', '유명인의 이름을 제목에 내세워 호기심을 유발한다'],
  ['c5', 'A', '시의성 있는 신제품 출시일에 맞춰 현장 구매 과정을 콘텐츠로 다룬다.'],
]

test('★ AI 묶기가 죽어도 같은 뜻은 묶인다 — 안 묶으면 결과가 언제나 0건이다', () => {
  const f: RawFinding[] = REAL_FINDINGS.map(([contentId, channelId, statement]) => ({
    contentId, channelId, statement, observation: '',
  }))
  const clusters = clusterByOverlap(f)
  const big = clusters.find((c) => c.contentIds.length >= 3)
  assert.ok(big, `가장 큰 묶음이 ${Math.max(...clusters.map((c) => c.contentIds.length))}건 — 유명인 계열 4개가 안 묶였다`)

  // 그리고 그 묶음이 실제로 승격까지 간다 (채널 3곳 이상)
  const r = promoteDiscoveries(clusters, f)
  assert.ok(r.promoted.length >= 1, '묶였는데도 승격이 0건이다')
  assert.ok(r.promoted[0].channelCount >= DISCOVERY_MIN_CHANNELS)
})

test('뜻이 다른 문장은 억지로 묶지 않는다 — 문턱이 무의미해지면 안 된다', () => {
  const f: RawFinding[] = [
    { contentId: 'x1', channelId: 'A', statement: '유명인의 이름을 제목에 내세운다', observation: '' },
    { contentId: 'x2', channelId: 'B', statement: '주말 아침에 올린다', observation: '' },
  ]
  assert.equal(clusterByOverlap(f).length, 2)
})

test('★ 대표 문장은 뭉뚱그린 것을 피한다 — "다양한 형태의 제목 전략"이 실제로 뽑혔던 자리', () => {
  // 실측: 근거 21건짜리 대표가 뭉뚱그린 문장으로 뽑혀 따라 만들 수가 없었다.
  // 원인은 문턱이 아니라 "가장 긴 것"을 고른 규칙이었다.
  const picked = pickRepresentative([
    '시청자의 호기심을 유발하는 다양한 형태의 제목 전략을 여러 방식으로 활용한다',
    '유명인의 이름을 제목 맨 앞에 배치해 호기심을 자극한다',
  ])
  assert.match(picked, /맨 앞에/, `뭉뚱그린 문장이 뽑혔다: ${picked}`)
})

test('구체적인 문장이 여럿이면 정보가 많은 쪽을 고른다', () => {
  const picked = pickRepresentative(['짧게 만든다', '60초 이내로 줄여 이탈을 막는다'])
  assert.match(picked, /60초/)
})

test('빈 입력에서 터지지 않는다', () => {
  assert.deepEqual(clusterByOverlap([]), [])
})

// ── AI 묶기 보정 ───────────────────────────────────────────
// 실측(2026-08-27): 같은 12개 문장을 두고 AI가 한 번은 4건 군집을 만들고,
// 다음 실행에서는 11개를 거의 전부 홀로 뒀다. 파이프라인이 AI의 그날 결과에
// 좌우되면 결과가 0건이 된다 — 그래서 뒤에서 한 번 더 합친다.

test('★ AI가 홀로 둔 같은 뜻을 다시 합친다 — 승격 0건의 실제 원인이었다', () => {
  const aiSaid: FindingCluster[] = [
    { statement: '대중적 인지도가 높은 유명인의 이름을 제목에 언급해 호기심을 유발한다', contentIds: ['c1'] },
    { statement: '대중적 인지도가 높은 유명인의 이름을 제목에 배치해 호기심을 자극한다', contentIds: ['c2'] },
    { statement: '대중적 인지도가 높은 유명인의 이름을 제목에 명시해 호기심을 끈다', contentIds: ['c3'] },
    { statement: '주말 아침 시간대에 올린다', contentIds: ['c4'] },
  ]
  const merged = mergeClusters(aiSaid)
  assert.equal(merged.length, 2, '유명인 계열 셋이 안 합쳐졌다')
  assert.equal(merged.find((c) => /유명/.test(c.statement))?.contentIds.length, 3)
})

test('AI가 이미 잘 묶었으면 아무것도 바꾸지 않는다 — 멀쩡한 것을 흔들지 않는다', () => {
  const good: FindingCluster[] = [
    { statement: '실패담으로 시작한다', contentIds: ['a', 'b', 'c'] },
    { statement: '주말에 올린다', contentIds: ['d'] },
  ]
  const merged = mergeClusters(good)
  assert.equal(merged.length, 2)
  assert.deepEqual(merged[0].contentIds, ['a', 'b', 'c'])
})

test('합치면서 같은 콘텐츠를 두 번 세지 않는다', () => {
  const dup: FindingCluster[] = [
    { statement: '유명인 이름을 제목에 쓴다', contentIds: ['x', 'y'] },
    { statement: '유명인 이름을 제목에 앞세운다', contentIds: ['y', 'z'] },
  ]
  const [c] = mergeClusters(dup)
  assert.deepEqual(c.contentIds.sort(), ['x', 'y', 'z'])
})
