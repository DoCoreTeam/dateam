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
{"channelMetadataRenderer":{"title":"추성훈 ChooSungHoon","externalId":"UCabcdefghijklmnopqrstuv"}}
{"vanityChannelUrl":"https://www.youtube.com/@Choosunghoon_ajossi"}
`

/**
 * 실제 채널 페이지에는 **주인 말고도** 채널 ID가 잔뜩 들어 있다 —
 * 추천 채널, 피처드 영상의 소유자, 커뮤니티 글 작성자.
 * 그것들은 전부 `"channelId"`로 실리고, 주인만 `externalId`·canonical에 실린다.
 *
 * 실측 사고: `@jawed` 페이지에서 첫 번째 channelId를 집어 남의 채널(UCPszu…)을 저장했다.
 * 그 결과 같은 채널이 서로 다른 UC 두 개로 쪼개져 형제 콘텐츠가 흩어졌다.
 */
const WITH_RECOMMENDED = `
<link rel="canonical" href="https://www.youtube.com/channel/UC4QobU6STFB0P71PMvOGN5A">
<meta property="og:title" content="jawed">
{"channelId":"UCPszuZ3hR89D4NqFd7g3mDQ","title":{"simpleText":"추천 채널 A"}}
{"channelId":"UCXuqSBlHAE6Xw-yeJA0Tunw","title":{"simpleText":"추천 채널 B"}}
{"channelMetadataRenderer":{"externalId":"UC4QobU6STFB0P71PMvOGN5A"}}
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

test('채널 ID는 주인 것만 읽는다 — 추천 채널 ID를 주워 담지 않는다', () => {
  const meta = parseChannelPage(WITH_RECOMMENDED)
  assert.equal(meta.externalId, 'UC4QobU6STFB0P71PMvOGN5A')
  assert.notEqual(meta.externalId, 'UCPszuZ3hR89D4NqFd7g3mDQ')
})

test('주인 ID를 확정할 근거가 없으면 null — 아무 UC나 집지 않는다', () => {
  // 추천 채널만 있고 canonical·externalId가 없는 페이지.
  // 틀린 ID를 저장하면 채널이 영구히 쪼개지므로, 없는 게 낫다.
  const onlyOthers = `{"channelId":"UCPszuZ3hR89D4NqFd7g3mDQ"}<meta property="og:title" content="x">`
  assert.equal(parseChannelPage(onlyOthers).externalId, null)
})

test('canonical 링크만 있어도 주인 ID를 읽는다 (속성 순서 무관)', () => {
  const a = `<link rel="canonical" href="https://www.youtube.com/channel/UC4QobU6STFB0P71PMvOGN5A">`
  const b = `<link href="https://www.youtube.com/channel/UC4QobU6STFB0P71PMvOGN5A" rel="canonical">`
  assert.equal(parseChannelPage(a).externalId, 'UC4QobU6STFB0P71PMvOGN5A')
  assert.equal(parseChannelPage(b).externalId, 'UC4QobU6STFB0P71PMvOGN5A')
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
