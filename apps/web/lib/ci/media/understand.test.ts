// lib/ci/media/understand.test.ts — 영상 실체 이해 가드
//
// 이 가드가 지키는 것은 하나다: **모델이 지어낸 것을 우리가 사실로 저장하지 않는다.**
// 영상을 못 본 상태에서 대사를 받아 적으면, 화면은 "분석됐다"고 말하는데 내용은 허구다.
// 그건 아무것도 안 나오는 것보다 나쁘다.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildUnderstandPrompt, parseUnderstanding, extractJsonBlock,
  understandingToEvidenceText, hasUsableEvidence,
  EMPTY_UNDERSTANDING, HOOK_DEVICES, SHOT_TYPES, PACING_VALUES,
} from './understand.ts'
import { resolveAccess, mediaCapability, MEDIA_CAPABILITY } from './capability.ts'
import { CI_PLATFORMS } from '../types.ts'

/* ───────── 능력표 ───────── */

test('플랫폼 전부가 능력표에 있다 — 빠진 플랫폼은 조용히 none이 되어 원인을 못 찾는다', () => {
  for (const p of CI_PLATFORMS) {
    const cap = MEDIA_CAPABILITY[p]
    assert.ok(cap, `${p}가 능력표에 없다`)
    assert.ok(cap.note.trim().length > 0, `${p}에 사용자에게 보여줄 설명이 없다`)
  }
})

test('영상 주소가 없으면 YouTube라도 영상으로 보지 않는다', () => {
  const r = resolveAccess({ platform: 'youtube', canonicalUrl: null, thumbnailUrl: 'https://x/t.jpg' })
  assert.equal(r.access, 'still_image')
})

test('영상도 이미지도 없으면 none이고, 왜 못 하는지 말한다', () => {
  const r = resolveAccess({ platform: 'tiktok', canonicalUrl: 'https://x', thumbnailUrl: null })
  assert.equal(r.access, 'none')
  assert.match(r.note, /확보하지 못했습니다/)
})

test('영상을 못 여는 플랫폼은 이유를 말한다 — 빈 화면은 고장으로 읽힌다', () => {
  assert.equal(mediaCapability('tiktok').access, 'still_image')
  assert.match(mediaCapability('tiktok').note, /공개하지 않아/)
})

/* ───────── 프롬프트 ───────── */

test('이미지만 줄 때는 대사·구간을 null로 두라고 명시한다 — 안 그러면 지어낸다', () => {
  const p = buildUnderstandPrompt({
    hasVideo: false, hasImage: true, title: 't', caption: null, durationSec: 30,
  })
  assert.match(p, /커버 이미지 한 장/)
  assert.match(p, /추측해서 채우지 마세요/)
  assert.ok(!/영상을 처음부터 끝까지/.test(p), '이미지만 있는데 영상을 보라고 지시하면 안 된다')
})

test('영상을 줄 때는 그대로 옮기라고 지시한다', () => {
  const p = buildUnderstandPrompt({
    hasVideo: true, hasImage: false, title: 't', caption: 'c', durationSec: 32,
  })
  assert.match(p, /영상 원본/)
  assert.match(p, /요약하거나 다듬지 마세요/)
  assert.match(p, /길이: 32초/)
})

test('허용 목록이 프롬프트에 실제로 실린다 — 목록과 프롬프트가 갈리면 파서가 전부 버린다', () => {
  const p = buildUnderstandPrompt({
    hasVideo: true, hasImage: false, title: null, caption: null, durationSec: null,
  })
  for (const v of PACING_VALUES) assert.ok(p.includes(v), `pacing '${v}'가 프롬프트에 없다`)
  for (const v of HOOK_DEVICES) assert.ok(p.includes(v), `hookDevice '${v}'가 프롬프트에 없다`)
  for (const v of SHOT_TYPES) assert.ok(p.includes(v), `shotType '${v}'가 프롬프트에 없다`)
})

test('★ 구간을 여러 칸으로 나누라고 지시한다 — 예시만 한 칸 주면 한 칸만 온다', () => {
  const p = buildUnderstandPrompt({
    hasVideo: true, hasImage: false, title: null, caption: null, durationSec: 32,
  })
  // 실측: 지시 없이 예시 한 칸만 주었더니 21건 중 19건이 beats 1칸으로 왔다.
  // 그러면 '구간 전개'가 아니라 그냥 요약문이고, 편집점 화면이 쓸 타임라인이 안 된다.
  assert.match(p, /한 칸만 만들지 마세요/)
  assert.match(p, /처음부터 끝까지/)
  const example = p.split('\n').find((l) => l.includes('"beats"')) ?? ''
  const slots = (example.match(/"t":/g) ?? []).length
  assert.ok(slots >= 3, `beats 예시가 ${slots}칸이다 — 여러 칸을 보여줘야 여러 칸이 온다`)
})

/* ───────── 파서 ───────── */

const REAL_RESPONSE = JSON.stringify({
  transcript: '조만간 인영이 메뉴 하나 나와야 되는 거 아니에요?',
  onScreenText: ['내 이름을 딴 메뉴 출시!!', '엔젤 유인영 롤', '엔젤 유인영 롤'],
  beats: [{ t: '0-3', what: '기대감 표출' }, { t: '3-19', what: '비하인드' }],
  hookDevice: '자막 선언',
  hookMessage: '내 이름을 딴 메뉴가 출시되었다',
  ending: '만족감을 표현하며 마무리',
  cutCount: 12,
  pacing: '보통',
  shotTypes: ['클로즈업', '셀카', '화면녹화'],
  aspect: '세로',
  hasSubtitle: true,
  subtitleStyle: '하단 중앙 흰색 고딕',
  audioStyle: '대화',
  setting: '일식당',
  peopleCount: 2,
  topicGuess: '맛집',
  topicEvidence: '연예인 이름을 딴 메뉴를 소개·시식',
  whyItWorks: '이름이 걸린 메뉴라는 호기심',
  replicableFormula: '특색 메뉴 + 비하인드 스토리',
  loopable: false,
  ctaPresent: false,
})

test('실측 응답을 그대로 읽는다', () => {
  const u = parseUnderstanding(REAL_RESPONSE)
  assert.ok(u)
  assert.equal(u.cutCount, 12)
  assert.equal(u.pacing, '보통')
  assert.equal(u.peopleCount, 2)
  assert.deepEqual(u.beats, [{ t: '0-3', what: '기대감 표출' }, { t: '3-19', what: '비하인드' }])
  assert.equal(u.hasSubtitle, true)
  assert.equal(u.loopable, false)     // false를 null로 뭉개면 "모른다"와 "아니다"가 섞인다
})

test('화면 자막의 중복은 턴다 — 같은 자막이 두 번 잡히는 것은 관측이 아니라 잡음이다', () => {
  const u = parseUnderstanding(REAL_RESPONSE)
  assert.deepEqual(u?.onScreenText, ['내 이름을 딴 메뉴 출시!!', '엔젤 유인영 롤'])
})

test('허용 목록에 없는 값은 버린다 — 자유 서술이 쌓이면 통계가 안 된다', () => {
  const u = parseUnderstanding(JSON.stringify({
    pacing: '아주아주 빠름', hookDevice: '뭔가 신기한 것', shotTypes: ['클로즈업', '드론뷰'],
    aspect: '9:16', audioStyle: '틱톡사운드',
  }))
  assert.equal(u?.pacing, null)
  assert.equal(u?.hookDevice, null)
  assert.equal(u?.aspect, null)
  assert.equal(u?.audioStyle, null)
  assert.deepEqual(u?.shotTypes, ['클로즈업'])
})

test('코드펜스로 감싸도 읽는다', () => {
  const u = parseUnderstanding('```json\n{"topicGuess":"요리"}\n```')
  assert.equal(u?.topicGuess, '요리')
})

test('형식이 깨졌으면 null — 반쯤 읽어 반쯤 저장하지 않는다', () => {
  assert.equal(parseUnderstanding('그건 좀 어렵네요'), null)
  assert.equal(parseUnderstanding('{깨진 json'), null)
  assert.equal(parseUnderstanding('[1,2,3]'), null)
  assert.equal(extractJsonBlock('no braces here'), null)
})

test('문자열 "null"은 값이 아니다 — 모델이 자주 이렇게 답한다', () => {
  const u = parseUnderstanding(JSON.stringify({ transcript: 'null', hookMessage: '  ' }))
  assert.equal(u?.transcript, null)
  assert.equal(u?.hookMessage, null)
})

test('음수 컷 수는 버린다', () => {
  const u = parseUnderstanding(JSON.stringify({ cutCount: -3, peopleCount: 'abc' }))
  assert.equal(u?.cutCount, null)
  assert.equal(u?.peopleCount, null)
})

/* ───────── 증거 ───────── */

test('빈 결과를 증거라고 부르지 않는다', () => {
  assert.equal(hasUsableEvidence(EMPTY_UNDERSTANDING), false)
  assert.equal(understandingToEvidenceText(EMPTY_UNDERSTANDING), '')
})

test('대사·자막이 분류 증거 텍스트로 나간다 — 이것이 L2가 못 보던 새 증거다', () => {
  const u = parseUnderstanding(REAL_RESPONSE)
  assert.ok(u && hasUsableEvidence(u))
  const text = understandingToEvidenceText(u)
  assert.match(text, /대사:/)
  assert.match(text, /화면 자막:/)
  assert.match(text, /영상이 말하는 주제: 맛집/)
  assert.match(text, /근거: 연예인 이름을 딴 메뉴/)
})

test('주제만 있고 근거가 없으면 근거 문구를 붙이지 않는다', () => {
  const u = parseUnderstanding(JSON.stringify({ topicGuess: '요리' }))
  assert.ok(u)
  assert.equal(understandingToEvidenceText(u), '영상이 말하는 주제: 요리')
})
