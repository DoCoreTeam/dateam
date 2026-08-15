import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseContentUrl, parseChannelUrl, parseAnyCiUrl } from './url.ts'

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

test('링크 종류 판별 — 게시물이 채널보다 먼저다(오인하면 계정 전체를 훑는다)', () => {
  assert.equal(parseAnyCiUrl('https://youtu.be/jNQXAC9IVRw')?.kind, 'content')
  assert.equal(parseAnyCiUrl('https://www.youtube.com/watch?v=jNQXAC9IVRw')?.kind, 'content')
  assert.equal(parseAnyCiUrl('https://www.youtube.com/shorts/abc12345678')?.kind, 'content')
  assert.equal(parseAnyCiUrl('https://www.instagram.com/reel/ABC123/')?.kind, 'content')
})

test('링크 종류 판별 — 채널·프로필 주소와 채널 탭은 channel', () => {
  assert.equal(parseAnyCiUrl('https://www.youtube.com/@jawed')?.kind, 'channel')
  assert.equal(parseAnyCiUrl('https://www.youtube.com/@jawed/videos')?.kind, 'channel')
  assert.equal(parseAnyCiUrl('https://www.youtube.com/@jawed/shorts')?.kind, 'channel')
  assert.equal(parseAnyCiUrl('https://www.youtube.com/channel/UC4QobU6STFB0P71PMvOGN5A')?.kind, 'channel')
  assert.equal(parseAnyCiUrl('https://www.tiktok.com/@someone')?.kind, 'channel')
})

test('★ @핸들 뒤에 모르는 경로가 붙으면 채널로 단정하지 않는다 — 잘못 훑으면 비용이 크다', () => {
  assert.equal(parseAnyCiUrl('https://www.youtube.com/@jawed/video/abc'), null)
  assert.equal(parseAnyCiUrl('https://www.youtube.com/@jawed/무언가/xyz'), null)
})

test('링크 종류 판별 — 지원 안 하는 주소·쓰레기는 null (거부 이유를 화면이 말한다)', () => {
  assert.equal(parseAnyCiUrl('쓰레기'), null)
  assert.equal(parseAnyCiUrl('https://example.com/hello'), null)
  assert.equal(parseAnyCiUrl(''), null)
})

test('★ 틱톡 프로필은 게시물이 아니다 — 담으면 영상 0개짜리 깡통 콘텐츠가 생긴다', () => {
  assert.equal(parseContentUrl('https://www.tiktok.com/@someone'), null)
  assert.equal(parseAnyCiUrl('https://www.tiktok.com/@someone')?.kind, 'channel')
  // 진짜 영상과 단축 링크는 그대로 게시물이어야 한다(과교정 방지)
  assert.equal(parseContentUrl('https://www.tiktok.com/@someone/video/7300000000000000000')?.externalId, '7300000000000000000')
  assert.equal(parseAnyCiUrl('https://vm.tiktok.com/ZMabcdef/')?.kind, 'content')
})
