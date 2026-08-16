import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  sortByPublishedDesc, pickBaselineIds, latestNonNullViews, newestViews,
  oldestSnapshots, groupMetricsDesc, topicComboKey, chunk,
  BASELINE_WINDOW, type ContentLite, type MetricRow,
} from './derive-select.ts'

// 이 파일이 지키는 것: 일괄 조회로 바꾸면서 **DB가 골라 주던 것과 같게** 고르는가.
// 규칙이 하나라도 어긋나면 배수가 조용히 바뀐다.

function c(id: string, o: Partial<ContentLite> = {}): ContentLite {
  return { id, channel_id: 'ch', format: 'short', published_at: '2026-01-01T00:00:00Z', ...o }
}
function m(content_id: string, captured_at: string, views: number | null): MetricRow {
  return { content_id, captured_at, views }
}

test('★ published_at DESC는 NULLS FIRST — Postgres 기본을 그대로 따른다', () => {
  const rows = [
    c('a', { published_at: '2026-01-02T00:00:00Z' }),
    c('b', { published_at: null }),
    c('d', { published_at: '2026-01-03T00:00:00Z' }),
  ]
  assert.deepEqual(sortByPublishedDesc(rows).map((r) => r.id), ['b', 'd', 'a'],
    '게시일 미상이 맨 앞이 아니면 비교군 구성이 달라진다')
})

test('같은 시각이면 id로 갈라 결정적으로 정렬한다', () => {
  const rows = [c('z'), c('a'), c('m')]
  assert.deepEqual(sortByPublishedDesc(rows).map((r) => r.id), ['a', 'm', 'z'])
})

test('★ 비교군은 같은 채널·같은 포맷·자기 제외 최근 20개', () => {
  const target = c('t', { published_at: '2026-06-01T00:00:00Z' })
  const pool = [
    target,
    c('same1', { published_at: '2026-05-01T00:00:00Z' }),
    c('other-ch', { channel_id: 'ch2', published_at: '2026-05-02T00:00:00Z' }),
    c('other-fmt', { format: 'long', published_at: '2026-05-03T00:00:00Z' }),
  ]
  assert.deepEqual(pickBaselineIds(target, pool), ['same1'])
})

test('비교군은 20개에서 끊긴다 — 최신 것부터', () => {
  const target = c('t', { published_at: '2026-12-31T00:00:00Z' })
  const pool = [target, ...Array.from({ length: 30 }, (_, i) =>
    c(`p${String(i).padStart(2, '0')}`, { published_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z` }))]
  const picked = pickBaselineIds(target, pool)
  assert.equal(picked.length, BASELINE_WINDOW)
  assert.equal(picked[0], 'p29', '최신부터 담지 않았다')
})

test('채널이 없으면 비교군도 없다', () => {
  assert.deepEqual(pickBaselineIds(c('t', { channel_id: null }), [c('x')]), [])
})

test('★ 비교군 조회수는 "최신 중 views가 있는 첫 행" — null은 건너뛰고 과거를 쓴다', () => {
  const byContent = groupMetricsDesc([
    m('a', '2026-01-03T00:00:00Z', null),   // 최신인데 비어 있음
    m('a', '2026-01-02T00:00:00Z', 500),    // → 이걸 쓴다
    m('a', '2026-01-01T00:00:00Z', 100),
    m('b', '2026-01-01T00:00:00Z', 7),
  ])
  assert.deepEqual(latestNonNullViews(['a', 'b'], byContent), [500, 7])
})

test('조회수가 전부 비어 있으면 비교군에서 빠진다 — 0으로 세지 않는다', () => {
  const byContent = groupMetricsDesc([m('a', '2026-01-01T00:00:00Z', null)])
  assert.deepEqual(latestNonNullViews(['a', 'missing'], byContent), [])
})

test('★ 대상 자신의 조회수는 "최신 행 그대로" — 비어 있으면 null (비교군 규칙과 다르다)', () => {
  const byContent = groupMetricsDesc([
    m('a', '2026-01-03T00:00:00Z', null),
    m('a', '2026-01-02T00:00:00Z', 500),
  ])
  assert.equal(newestViews('a', byContent), null, '두 규칙을 합치면 값이 조용히 바뀐다')
  assert.equal(newestViews('none', byContent), null)
})

test('속도용 스냅샷은 오래된 순 앞에서 50개', () => {
  const rows = Array.from({ length: 60 }, (_, i) =>
    m('a', `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, i))
  const got = oldestSnapshots('a', groupMetricsDesc(rows))
  assert.equal(got.length, 50)
  assert.equal(got[0].captured_at, '2026-01-01T00:00:00Z', '오래된 것부터가 아니다')
  assert.equal(got[49].captured_at, '2026-01-50T00:00:00Z')
})

test('지표는 콘텐츠별로 묶이고 최신순으로 정렬된다', () => {
  const g = groupMetricsDesc([
    m('a', '2026-01-01T00:00:00Z', 1),
    m('a', '2026-01-05T00:00:00Z', 5),
    m('b', '2026-01-02T00:00:00Z', 2),
  ])
  assert.deepEqual(g.get('a')?.map((r) => r.views), [5, 1])
  assert.deepEqual(g.get('b')?.map((r) => r.views), [2])
})

test('주제 조합 키가 플랫폼·포맷까지 가른다 — 합치면 남의 모집단이 섞인다', () => {
  assert.notEqual(topicComboKey('t', 'youtube', 'short'), topicComboKey('t', 'youtube', 'long'))
  assert.notEqual(topicComboKey('t', 'youtube', 'short'), topicComboKey('t', 'tiktok', 'short'))
  assert.equal(topicComboKey('t', null, null), topicComboKey('t', null, null))
})

test('★ id 묶음을 잘라 보낸다 — 한 번에 다 실으면 요청 URL이 길어져 깨진다', () => {
  const ids = Array.from({ length: 250 }, (_, i) => `id${i}`)
  const parts = chunk(ids)
  assert.deepEqual(parts.map((p) => p.length), [100, 100, 50])
  assert.deepEqual(parts.flat(), ids, '자르면서 빠뜨린 id가 있다')
  assert.deepEqual(chunk([]), [])
})
