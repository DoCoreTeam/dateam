/**
 * 녹음 구간 · 전사 매핑 가드
 *
 * 여기 있는 것들은 **화면으로 밟기 어렵거나, 틀려도 조용한** 계산이다.
 *   · 시간축 오프셋 — 틀리면 전사가 이어 붙었을 때 시각이 뒤죽박죽인데 눈으로는 그럴듯하다
 *   · mime 판정 — 모르는 형식을 받으면 전사 단계에서 실패하고, 그때는 이미 회의가 끝난 뒤다
 *   · 진행 문구 — 부분 실패를 숨기면 사용자는 10분이 없어진 걸 영영 모른다
 *   · 응답 매핑 — 여기가 틀리면 "전사는 됐는데 화면이 비는" 상태가 된다
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PART_MS, partOffsetMs, isAllowedAudioMime, extensionForMime, summarizeProgress,
} from './recording.ts'
import { mapVerboseJson, classifyHttpFailure, readSttSettings } from '../stt/provider.ts'

// ------------------------------------------------------------
// 시간축 오프셋
// ------------------------------------------------------------

test('첫 구간은 오프셋이 0이다', () => {
  assert.equal(partOffsetMs(0), 0)
})

test('★ 구간마다 10분씩 밀린다 — 이게 틀리면 전사 시각이 통째로 어긋난다', () => {
  assert.equal(partOffsetMs(1), 600_000)
  assert.equal(partOffsetMs(3), 1_800_000)
  assert.equal(PART_MS, 600_000)
})

test('음수·소수 구간 번호는 안전하게 잘린다', () => {
  assert.equal(partOffsetMs(-2), 0)
  assert.equal(partOffsetMs(2.9), 1_200_000)
})

// ------------------------------------------------------------
// mime 판정
// ------------------------------------------------------------

test('★ 브라우저가 붙이는 codecs 파라미터를 떼고 본다 — 안 그러면 크롬 녹음이 전부 거부된다', () => {
  assert.equal(isAllowedAudioMime('audio/webm;codecs=opus'), true)
  assert.equal(isAllowedAudioMime('audio/webm'), true)
})

test('Safari 가 보내는 mp4 도 받는다', () => {
  assert.equal(isAllowedAudioMime('audio/mp4'), true)
})

test('오디오가 아닌 것은 거부한다 — 전사 단계까지 끌고 가지 않는다', () => {
  assert.equal(isAllowedAudioMime('video/mp4'), false)
  assert.equal(isAllowedAudioMime('text/plain'), false)
  assert.equal(isAllowedAudioMime(''), false)
  assert.equal(isAllowedAudioMime(null), false)
})

test('확장자는 형식을 따라간다 — 드라이브에서 사람이 찾아 들을 수 있어야 한다', () => {
  assert.equal(extensionForMime('audio/webm;codecs=opus'), 'webm')
  assert.equal(extensionForMime('audio/mp4'), 'm4a')
  assert.equal(extensionForMime('audio/mpeg'), 'mp3')
  assert.equal(extensionForMime(null), 'webm')
})

// ------------------------------------------------------------
// 진행 문구 — 부분 실패를 숨기지 않는다
// ------------------------------------------------------------

test('녹음이 없으면 없다고 말한다', () => {
  const p = summarizeProgress([])
  assert.equal(p.total, 0)
  assert.equal(p.done, false)
  assert.equal(p.label, '녹음 없음')
})

test('진행 중이면 몇 개까지 됐는지 말한다', () => {
  const p = summarizeProgress([
    { status: 'TRANSCRIBED' }, { status: 'TRANSCRIBED' }, { status: 'UPLOADED' },
  ])
  assert.equal(p.done, false)
  assert.equal(p.label, '전사 중 2/3구간')
})

test('전부 끝나면 완료로 바뀐다', () => {
  const p = summarizeProgress([{ status: 'TRANSCRIBED' }, { status: 'TRANSCRIBED' }])
  assert.equal(p.done, true)
  assert.equal(p.failed, 0)
  assert.equal(p.label, '전사 완료 · 2구간')
})

test('★ 일부가 실패해도 done 이다 — 안 그러면 화면이 영원히 "전사 중"에 갇힌다', () => {
  const p = summarizeProgress([
    { status: 'TRANSCRIBED' }, { status: 'FAILED' }, { status: 'TRANSCRIBED' },
  ])
  assert.equal(p.done, true)
  assert.equal(p.failed, 1)
})

test('★ 실패 개수를 문구에 드러낸다 — 숨기면 사용자는 10분이 사라진 걸 모른다', () => {
  const p = summarizeProgress([{ status: 'TRANSCRIBED' }, { status: 'FAILED' }])
  assert.ok(p.label.includes('1구간 실패'), p.label)
})

// ------------------------------------------------------------
// 전사 응답 매핑
// ------------------------------------------------------------

test('세그먼트를 초 → 밀리초로 옮긴다', () => {
  const segs = mapVerboseJson({ segments: [{ start: 1.5, end: 3.25, text: '예산은 3억입니다' }] })
  assert.equal(segs.length, 1)
  assert.equal(segs[0].startMs, 1500)
  assert.equal(segs[0].endMs, 3250)
  assert.equal(segs[0].text, '예산은 3억입니다')
})

test('★ end 가 start 와 같으면 1ms 를 준다 — DB 가 end > start 를 요구해 구간 전체가 저장에 실패한다', () => {
  const segs = mapVerboseJson({ segments: [{ start: 2, end: 2, text: '네' }] })
  assert.equal(segs[0].endMs, segs[0].startMs + 1)
})

test('빈 텍스트 줄은 버린다 — 빈 줄이 근거 인용으로 나가면 안 된다', () => {
  const segs = mapVerboseJson({ segments: [
    { start: 0, end: 1, text: '  ' },
    { start: 1, end: 2, text: '진짜 말' },
  ] })
  assert.equal(segs.length, 1)
  assert.equal(segs[0].text, '진짜 말')
})

test('★ segments 없이 text 만 와도 살린다 — 버리면 회의가 통째로 사라진다', () => {
  const segs = mapVerboseJson({ text: '전체 전사 내용' })
  assert.equal(segs.length, 1)
  assert.equal(segs[0].text, '전체 전사 내용')
})

test('아무것도 없으면 빈 배열 — 호출부가 "말소리를 못 찾았다"고 말한다', () => {
  assert.equal(mapVerboseJson({}).length, 0)
  assert.equal(mapVerboseJson(null).length, 0)
})

test('화자를 지어내지 않는다 — 목소리로 사람을 특정해 틀리면 잘못된 참석자가 들어간다', () => {
  const segs = mapVerboseJson({ segments: [{ start: 0, end: 1, text: '안녕하세요' }] })
  assert.equal(segs[0].speaker, '화자')
})

// ------------------------------------------------------------
// 실패 분류 — "다시 시도"가 100% 또 실패할 것은 그렇게 말하지 않는다
// ------------------------------------------------------------

test('★ 키 오류는 재시도하지 않는다 — 재시도해도 100% 또 실패한다', () => {
  const e = classifyHttpFailure(401, '')
  assert.equal(e.reason, 'auth')
  assert.equal(e.retryable, false)
  assert.ok(e.userMessage.includes('시스템 설정'))
})

test('한도(429)와 서버 오류(5xx)는 재시도한다', () => {
  assert.equal(classifyHttpFailure(429, '').retryable, true)
  assert.equal(classifyHttpFailure(503, '').retryable, true)
})

test('파일이 너무 크면 재시도하지 않는다 — 같은 파일이 작아지지 않는다', () => {
  const e = classifyHttpFailure(413, '')
  assert.equal(e.reason, 'too_large')
  assert.equal(e.retryable, false)
})

// ------------------------------------------------------------
// 설정 읽기
// ------------------------------------------------------------

test('★ 키가 없으면 null — 조용히 기본값으로 돌면 "녹음은 되는데 전사가 영영 안 되는" 상태가 된다', () => {
  assert.equal(readSttSettings({}), null)
  assert.equal(readSttSettings({ stt_api_key: '   ' }), null)
})

test('키만 있으면 프로바이더·모델은 기본값으로 채운다', () => {
  const s = readSttSettings({ stt_api_key: 'k' })
  assert.ok(s)
  assert.equal(s.provider, 'groq')
  assert.equal(s.model, 'whisper-large-v3')
})

test('★ 기본 모델은 turbo 가 아니다 — 정확도를 요구받았고 turbo 는 1~2%p 손해다', () => {
  const s = readSttSettings({ stt_api_key: 'k' })
  assert.ok(s)
  assert.ok(!s.model.includes('turbo'), s.model)
})

test('어드민이 고른 모델이 있으면 그걸 존중한다', () => {
  const s = readSttSettings({ stt_api_key: 'k', stt_model: 'whisper-large-v3-turbo' })
  assert.equal(s?.model, 'whisper-large-v3-turbo')
})
