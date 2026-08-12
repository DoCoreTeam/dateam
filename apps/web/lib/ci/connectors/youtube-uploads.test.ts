import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePlaylistItems, bestThumbnail, fetchAllUploads } from './youtube-uploads.ts'

test('썸네일은 큰 것부터 고른다', () => {
  assert.equal(
    bestThumbnail({ default: { url: 'd' }, high: { url: 'h' }, maxres: { url: 'm' } }),
    'm',
  )
  assert.equal(bestThumbnail({ default: { url: 'd' } }), 'd')
  assert.equal(bestThumbnail(undefined), null)
  assert.equal(bestThumbnail({}), null)
})

test('재생목록 항목을 업로드로 바꾼다', () => {
  const items = parsePlaylistItems({
    items: [{
      snippet: {
        title: '영상 하나',
        publishedAt: '2026-08-01T00:00:00Z',
        resourceId: { videoId: 'abc123' },
        thumbnails: { high: { url: 'https://i.ytimg.com/vi/abc123/hq.jpg' } },
      },
    }],
  })
  assert.equal(items.length, 1)
  assert.equal(items[0].externalId, 'abc123')
  assert.equal(items[0].canonicalUrl, 'https://www.youtube.com/watch?v=abc123')
  assert.equal(items[0].title, '영상 하나')
  assert.ok(items[0].thumbnailUrl?.includes('abc123'))
})

test('영상 ID가 없는 행(비공개·삭제)은 버린다 — 유령 콘텐츠를 만들지 않는다', () => {
  const items = parsePlaylistItems({
    items: [
      { snippet: { title: '삭제된 동영상', resourceId: {} } },
      { snippet: { title: '정상', resourceId: { videoId: 'ok1' } } },
    ],
  })
  assert.equal(items.length, 1)
  assert.equal(items[0].externalId, 'ok1')
})

test('빈 응답도 예외 없이 빈 배열', () => {
  assert.deepEqual(parsePlaylistItems({}), [])
  assert.deepEqual(parsePlaylistItems({ items: [] }), [])
})

test('API 키가 없으면 전체 수집을 시도하지 않고 이유를 밝힌다', async () => {
  const r = await fetchAllUploads('UCabc', undefined)
  assert.equal(r.ok, false)
  assert.ok(!r.ok && r.needsKey, '키가 필요하다는 사실을 알려야 한다')
  assert.ok(!r.ok && r.error.includes('15개'), '지금 한계를 숫자로 밝혀야 한다')
})
