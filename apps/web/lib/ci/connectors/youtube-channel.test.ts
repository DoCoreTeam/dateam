import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseChannelPage, parseCompactCount, channelPageUrl } from './youtube-channel.ts'

// 실제 채널 페이지에서 잘라온 형태. 유튜브가 레이아웃을 바꿔
// subscriberCountText가 사라지고 metadataParts로 옮겨간 신규 형태다.
const NEW_LAYOUT = `
<meta property="og:title" content="추성훈 ChooSungHoon">
<meta property="og:description" content="유튭 신입 아조씨임다.">
<meta property="og:image" content="https://yt3.googleusercontent.com/abc=s900">
{"metadataParts":[{"text":{"content":"구독자 207만명"},"accessibilityLabel":"구독자 207만명"},
{"text":{"content":"동영상 543개"}}]}
{"channelId":"UCabcdefghijklmnopqrstuv"}
{"vanityChannelUrl":"https://www.youtube.com/@Choosunghoon_ajossi"}
`

const OLD_LAYOUT = `
<meta property="og:title" content="옛 레이아웃 채널">
{"subscriberCountText":{"simpleText":"구독자 12.3만명"}}
{"videosCountText":{"runs":[{"text":"1,234"}]}}
`

test('신규 레이아웃에서 구독자·영상 수를 읽는다', () => {
  const meta = parseChannelPage(NEW_LAYOUT)
  assert.equal(meta.subscriberCount, 2_070_000)
  assert.equal(meta.videoCount, 543)
})

test('구 레이아웃도 계속 읽는다 — 한쪽만 지원하면 조용히 비어버린다', () => {
  const meta = parseChannelPage(OLD_LAYOUT)
  assert.equal(meta.subscriberCount, 123_000)
  assert.equal(meta.videoCount, 1234)
})

test('이름·소개문·아바타·핸들을 함께 뽑는다', () => {
  const meta = parseChannelPage(NEW_LAYOUT)
  assert.equal(meta.displayName, '추성훈 ChooSungHoon')
  assert.equal(meta.description, '유튭 신입 아조씨임다.')
  assert.ok(meta.avatarUrl?.startsWith('https://yt3.'))
  assert.equal(meta.handle, '@Choosunghoon_ajossi')
  assert.equal(meta.externalId, 'UCabcdefghijklmnopqrstuv')
})

test('아무것도 못 읽으면 전부 null — 지어내지 않는다', () => {
  const meta = parseChannelPage('<html><body>빈 페이지</body></html>')
  assert.equal(meta.subscriberCount, null)
  assert.equal(meta.displayName, null)
  assert.equal(meta.description, null)
})

test('축약 수 표기를 수로 바꾼다', () => {
  assert.equal(parseCompactCount('207만'), 2_070_000)
  assert.equal(parseCompactCount('1.2천'), 1_200)
  assert.equal(parseCompactCount('3.4M'), 3_400_000)
  assert.equal(parseCompactCount('12,345'), 12345)
  assert.equal(parseCompactCount('1.5억'), 150_000_000)
  assert.equal(parseCompactCount(null), null)
  assert.equal(parseCompactCount('구독자 없음'), null)
})

test('채널 주소는 ID > 핸들 > 저장된 URL 순으로 만든다', () => {
  assert.equal(
    channelPageUrl({ externalId: 'UCabcdefghijklmnopqrstuv', handle: '@x', profileUrl: null }),
    'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',
  )
  // handle: 키가 붙은 임시 식별자는 채널 ID가 아니므로 핸들로 내려간다
  assert.equal(
    channelPageUrl({ externalId: null, handle: 'someone', profileUrl: null }),
    'https://www.youtube.com/@someone',
  )
  assert.equal(channelPageUrl({ externalId: null, handle: null, profileUrl: null }), null)
})
