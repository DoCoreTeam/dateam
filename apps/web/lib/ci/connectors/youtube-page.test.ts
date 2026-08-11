import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseWatchPage, parseDescription, parseKeywords, extractHashtags, sliceVideoDetails,
} from './youtube-page.ts'

// 실제 시청 페이지의 형태를 축약한 것.
// 핵심: 추천 영상의 channelId가 videoDetails보다 **앞에** 나온다 —
// 페이지 전체에서 처음 찾으면 남의 채널을 잡는다.
const WATCH = `
<html><head><meta name="keywords" content="메타키워드1, 메타키워드2"></head>
<script>
{"compactVideoRenderer":{"channelId":"UCRECOMMENDEDwrongchannel00"}}
var ytInitialPlayerResponse = {"videoDetails":{"videoId":"abc","title":"Me at the zoo",
"lengthSeconds":"19","keywords":["me at the zoo","jawed karim","first youtube video"],
"channelId":"UC4QobU6STFB0P71PMvOGN5A","shortDescription":"첫 줄\\n둘째 줄 #태그하나 #태그둘",
"author":"jawed"},"viewCount":"12345"};
{"externalChannelId":"UC4QobU6STFB0P71PMvOGN5A"}
{"lengthSeconds":"19"}
{"uploadDate":"2005-04-24T00:00:00-07:00"}
{"accessibilityText":"다른 사용자 1,234명과 함께 이 동영상에 좋아요 표시"}
</script></html>
`

test('소유자 채널 ID는 videoDetails에서 읽는다 — 추천 영상 채널을 잡지 않는다', () => {
  const p = parseWatchPage(WATCH)
  assert.equal(p.channelId, 'UC4QobU6STFB0P71PMvOGN5A')
  assert.notEqual(p.channelId, 'UCRECOMMENDEDwrongchannel00')
})

test('채널 이름도 이 영상 블록에서 읽는다', () => {
  assert.equal(parseWatchPage(WATCH).channelName, 'jawed')
})

test('설명문의 줄바꿈을 살린다 — 한 줄로 뭉개면 원문이 아니다', () => {
  const d = parseDescription(WATCH)
  assert.ok(d?.includes('\n'), `줄바꿈 없음: ${JSON.stringify(d)}`)
  assert.ok(d?.startsWith('첫 줄'))
})

test('키워드는 videoDetails와 설명문 해시태그만 — 업로더가 실제로 넣은 것', () => {
  const kws = parseKeywords(WATCH, parseDescription(WATCH))
  assert.equal(kws[0], 'me at the zoo')
  assert.ok(kws.includes('jawed karim'))
  assert.ok(kws.includes('태그하나'))
})

test('유튜브 상투어 meta 키워드는 쓰지 않는다 — 이 영상의 키워드가 아니다', () => {
  // 유튜브가 모든 시청 페이지에 똑같이 박아 두는 값. 화면에 "동영상·공유·카메라폰"이 뜨던 사고.
  const boilerplate = '<meta name="keywords" content="동영상, 공유, 카메라폰, 동영상폰, 무료, 올리기">'
  assert.deepEqual(parseKeywords(boilerplate, null), [])
  // videoDetails가 있는 페이지에서도 상투어는 섞이지 않는다
  const kws = parseKeywords(WATCH, parseDescription(WATCH))
  assert.ok(!kws.includes('동영상'))
  assert.ok(!kws.includes('메타키워드1'))
})

test('해시태그를 설명문에서 뽑는다', () => {
  assert.deepEqual(extractHashtags('본문 #하나 #둘 #하나'), ['하나', '둘'])
  assert.deepEqual(extractHashtags(null), [])
})

test('videoDetails가 없으면 null — 없는 블록을 지어내지 않는다', () => {
  assert.equal(sliceVideoDetails('<html>아무것도 없음</html>'), null)
})

test('지표를 읽는다', () => {
  const p = parseWatchPage(WATCH)
  assert.equal(p.views, 12345)
  assert.equal(p.likes, 1234)
  assert.equal(p.durationSec, 19)
})
