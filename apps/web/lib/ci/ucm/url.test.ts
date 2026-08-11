import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseContentUrl, parseChannelUrl } from './url.ts'

test('YouTube 일반·쇼츠·단축·라이브 링크를 모두 같은 ID로 정규화한다', () => {
  const ids = [
    'https://www.youtube.com/watch?v=abc123XYZ_-',
    'https://youtu.be/abc123XYZ_-',
    'https://www.youtube.com/embed/abc123XYZ_-',
  ].map((u) => parseContentUrl(u))
  for (const r of ids) {
    assert.equal(r?.platform, 'youtube')
    assert.equal(r?.externalId, 'abc123XYZ_-')
    assert.equal(r?.canonicalUrl, 'https://www.youtube.com/watch?v=abc123XYZ_-')
  }
})

test('쇼츠와 라이브는 URL만으로 포맷을 확정한다', () => {
  assert.equal(parseContentUrl('https://youtube.com/shorts/s1')?.formatHint, 'short')
  assert.equal(parseContentUrl('https://youtube.com/live/l1')?.formatHint, 'live')
  assert.equal(parseContentUrl('https://www.youtube.com/watch?v=v1')?.formatHint, 'long')
})

test('TikTok 영상 링크', () => {
  const r = parseContentUrl('https://www.tiktok.com/@cook/video/7412345678901234567')
  assert.equal(r?.platform, 'tiktok')
  assert.equal(r?.externalId, '7412345678901234567')
  assert.equal(r?.formatHint, 'short')
})

test('Instagram 릴스는 short, 게시물은 image로 힌트를 준다', () => {
  assert.equal(parseContentUrl('https://www.instagram.com/reel/CxYz1/')?.formatHint, 'short')
  assert.equal(parseContentUrl('https://www.instagram.com/p/CxYz1/')?.formatHint, 'image')
})

test('X와 Threads는 텍스트 포맷', () => {
  const x = parseContentUrl('https://x.com/someone/status/1790000000000000000')
  assert.equal(x?.platform, 'x')
  assert.equal(x?.externalId, '1790000000000000000')
  assert.equal(x?.formatHint, 'text')
  // twitter.com도 x.com으로 정규화
  assert.equal(parseContentUrl('https://twitter.com/someone/status/17900')?.canonicalUrl,
    'https://x.com/someone/status/17900')
  assert.equal(parseContentUrl('https://www.threads.net/@who/post/C1a2b')?.platform, 'threads')
})

test('Facebook 영상과 story_fbid', () => {
  assert.equal(parseContentUrl('https://www.facebook.com/page/videos/123456')?.externalId, '123456')
  assert.equal(parseContentUrl('https://www.facebook.com/permalink.php?story_fbid=999&id=1')?.externalId, '999')
})

test('스킴이 없어도 파싱한다 (붙여넣기 현실 대응)', () => {
  assert.equal(parseContentUrl('youtube.com/watch?v=noscheme')?.externalId, 'noscheme')
})

test('지원하지 않는 링크와 쓰레기 입력은 예외 없이 null', () => {
  assert.equal(parseContentUrl('https://example.com/video/1'), null)
  assert.equal(parseContentUrl('그냥 텍스트'), null)
  assert.equal(parseContentUrl(''), null)
  assert.equal(parseContentUrl('   '), null)
  assert.equal(parseContentUrl('https://youtube.com/'), null)  // 영상 ID 없음
})

test('채널 URL은 핸들과 채널ID를 구분해 인식한다', () => {
  assert.deepEqual(
    { ...parseChannelUrl('https://www.youtube.com/@cookingchannel')!, url: '' },
    { platform: 'youtube', handle: '@cookingchannel', externalId: null, url: '' },
  )
  const byId = parseChannelUrl('https://www.youtube.com/channel/UC12345')
  assert.equal(byId?.externalId, 'UC12345')
  assert.equal(byId?.handle, null)
})

test('채널 URL 판별이 게시물 URL을 채널로 오인하지 않는다', () => {
  assert.equal(parseChannelUrl('https://www.instagram.com/p/CxYz1/'), null)
  assert.equal(parseChannelUrl('https://www.instagram.com/reel/CxYz1/'), null)
})
