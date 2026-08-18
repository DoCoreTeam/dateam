// lib/ci/format/media-info.test.ts — 영상 분석 표시 가드
//
// 막는 것은 **화면이 거짓말하는 것** 두 가지다. 둘 다 실브라우저에서 잡혔다.
//   ① 못 읽었는데 "영상 전체를 읽음" 배지가 붙는다 — 시도한 방법을 성과처럼 보여줬다
//   ② 외부 API 원문 영어가 그대로 뜬다 — `{"error":{"code":429,"message":"You exceeded..."}}`
//      사용자는 읽고도 무엇을 해야 할지 알 수 없고, 제품이 고장난 것으로 보인다

import test from 'node:test'
import assert from 'node:assert/strict'
import { toMediaInfo, accessLabel, humanizeMediaError, productionText, type MediaRow } from './media-info.ts'

function row(p: Partial<MediaRow> = {}): MediaRow {
  return {
    content_id: 'c1', transcript: null, on_screen_text: null, beats: null,
    hook_device: null, hook_message: null, ending: null, cut_count: null, pacing: null,
    shot_types: null, aspect: null, has_subtitle: null, subtitle_style: null, audio_style: null,
    setting: null, people_count: null, topic_guess: null, topic_evidence: null,
    why_it_works: null, replicable_formula: null, access_method: null, evidence: null,
    analyzed_at: null, ...p,
  }
}

/* ───── ① 배지가 성과를 말한다 ───── */

test('★ 영상을 넘겼지만 못 읽었으면 "영상 전체를 읽음"이라 하지 않는다', () => {
  const info = toMediaInfo(row({
    access_method: 'remote_video',
    evidence: { note: 'AI 응답 실패 (429) quota' },
  }))
  assert.equal(info.accessLabel, '영상을 읽지 못함')
  assert.equal(info.access, 'none')
})

test('실제로 읽었으면 방법을 그대로 말한다', () => {
  const v = toMediaInfo(row({ access_method: 'remote_video', transcript: '안녕하세요' }))
  assert.equal(v.accessLabel, '영상 전체를 읽음')
  assert.equal(v.access, 'remote_video')

  const i = toMediaInfo(row({ access_method: 'still_image', topic_guess: '요리' }))
  assert.equal(i.accessLabel, '커버 이미지만 읽음')
  assert.equal(i.access, 'still_image')
})

test('자막만 건져도 읽은 것이다 — 대사 없는 영상이 있다', () => {
  const v = toMediaInfo(row({ access_method: 'remote_video', on_screen_text: ['가나다'] }))
  assert.equal(v.accessLabel, '영상 전체를 읽음')
})

test('accessLabel은 성과를 함께 받는다 — 방법만 보면 거짓말한다', () => {
  assert.equal(accessLabel('remote_video', false), '영상을 읽지 못함')
  assert.equal(accessLabel('remote_video', true), '영상 전체를 읽음')
})

/* ───── ② 사용자가 읽을 수 있는 말 ───── */

test('★ 외부 API 원문이 화면으로 새지 않는다', () => {
  const raw = 'AI 응답 실패 (429) { "error": { "code": 429, "message": "You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-a'
  const msg = humanizeMediaError(raw)
  assert.ok(msg)
  assert.ok(!msg.includes('quota'), '영어 원문이 남아 있다')
  assert.ok(!msg.includes('{'), 'JSON 조각이 남아 있다')
  assert.ok(!msg.includes('http'), 'URL이 남아 있다')
  assert.match(msg, /사용량 한도/)
  assert.match(msg, /자동으로 다시 시도/, '사용자가 무엇을 기다리면 되는지 말해야 한다')
})

test('실패 종류마다 다른 말을 한다 — 전부 같은 문구면 아무 정보가 없다', () => {
  const msgs = [
    humanizeMediaError('AI 응답 실패 (429) quota'),
    humanizeMediaError('AI 응답이 시간 안에 오지 않았습니다'),
    humanizeMediaError('AI 응답 실패 (503) upstream'),
    humanizeMediaError('AI 응답 실패 (404) not found'),
  ]
  assert.equal(new Set(msgs).size, 4, '서로 다른 실패가 같은 문구로 뭉개졌다')
  assert.match(msgs[3] ?? '', /비공개이거나 삭제/)
})

test('우리가 쓴 한국어 문구는 그대로 보여준다 — 두 번 번역하지 않는다', () => {
  assert.equal(humanizeMediaError('20분을 넘는 영상은 읽지 않습니다'), '20분을 넘는 영상은 읽지 않습니다')
  assert.equal(humanizeMediaError('영상을 읽었지만 말·자막·주제 근거를 찾지 못했습니다'),
    '영상을 읽었지만 말·자막·주제 근거를 찾지 못했습니다')
})

test('알 수 없는 영어 오류도 사람 말로 바꾼다 — 날 것을 내보내지 않는다', () => {
  const msg = humanizeMediaError('ECONNRESET socket hang up')
  assert.ok(msg && !msg.includes('ECONNRESET'))
})

test('★ toMediaInfo가 실제로 번역을 거친다 — 함수만 있고 안 쓰면 소용없다', () => {
  // 이 단정이 없어서 "원문을 그대로 내보내는" 파괴가 가드를 통과했다.
  // humanizeMediaError를 직접 부르는 테스트만으로는 **호출되는지**를 못 지킨다.
  const raw = 'AI 응답 실패 (429) { "error": { "code": 429, "message": "You exceeded your current quota" } }'
  const info = toMediaInfo(row({ access_method: 'remote_video', evidence: { note: raw } }))
  assert.ok(info.note)
  assert.notEqual(info.note, raw, '원문이 그대로 화면 데이터로 나갔다')
  assert.ok(!info.note.includes('quota'))
  assert.ok(!info.note.includes('{'))
  assert.match(info.note, /사용량 한도/)
})

test('★ 어떤 실패 원문이 와도 화면 데이터에 영어·JSON이 남지 않는다', () => {
  const raws = [
    'AI 응답 실패 (500) Internal Server Error',
    'ECONNRESET socket hang up',
    '{"error":{"status":"RESOURCE_EXHAUSTED"}}',
    'AI 응답 실패 (403) forbidden: video is private',
  ]
  for (const raw of raws) {
    const note = toMediaInfo(row({ evidence: { note: raw } })).note ?? ''
    assert.ok(note.length > 0, `${raw} → 빈 문구`)
    assert.ok(!/[{}]|"error"|http|[A-Z]{5,}/.test(note), `원문 조각이 남았다: ${note}`)
    assert.ok(/[가-힣]/.test(note), `한국어가 아니다: ${note}`)
  }
})

test('사유가 없으면 null — 없는 오류를 만들어내지 않는다', () => {
  assert.equal(humanizeMediaError(null), null)
  assert.equal(humanizeMediaError('   '), null)
  assert.equal(toMediaInfo(row()).note, null)
})

/* ───── 연출 한 줄 ───── */

test('연출은 있는 것만 모아 한 줄로 — 항목마다 줄을 만들면 구멍투성이가 된다', () => {
  assert.equal(
    productionText(row({ aspect: '세로', cut_count: 12, has_subtitle: true, audio_style: '대화' })),
    '세로 · 컷 12회 · 자막 있음 · 대화',
  )
  assert.equal(productionText(row()), null)
})

test('자막 없음과 모름을 구분한다 — false를 null로 뭉개면 사실이 사라진다', () => {
  assert.match(productionText(row({ has_subtitle: false })) ?? '', /자막 없음/)
  assert.equal(productionText(row({ has_subtitle: null })), null)
})
