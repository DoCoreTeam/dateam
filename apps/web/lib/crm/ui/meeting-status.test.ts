/**
 * 미팅 상태 판정 가드
 *
 * 예전 목록은 `summaryMd` 하나만 보고 '정리됨/전사 대기'라고 했다.
 * 그래서 **전사가 실패한 미팅이 '대기'로 위장**됐고, 아무도 그걸 발견하지 못했다.
 * 여기서 고정하는 것은 그 위장이 다시 생기지 않는다는 것이다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MEETING_STATUS_META, MEETING_STATUS_ORDER, meetingStatusKey, meetingStatusMeta,
} from './meeting-status.ts'

test('요약이 있으면 정리됨 — 앞 단계가 어떻든 사용자가 원한 결과는 나왔다', () => {
  assert.equal(meetingStatusKey({ summaryMd: '결정 3건', recordingStatuses: [] }), 'SUMMARIZED')
  assert.equal(meetingStatusKey({ summaryMd: '결정 3건', recordingStatuses: ['FAILED'] }), 'SUMMARIZED')
})

test('공백만 있는 요약은 요약이 아니다 — 빈 문자열이 "정리됨"으로 거짓말한다', () => {
  assert.equal(meetingStatusKey({ summaryMd: '   ', recordingStatuses: [] }), 'EMPTY')
})

test('녹음이 하나도 없으면 기록 없음', () => {
  assert.equal(meetingStatusKey({ summaryMd: null, recordingStatuses: [] }), 'EMPTY')
})

test('★ 전부 실패면 실패라고 말한다 — 이 자리가 없으면 실패가 대기로 위장된다', () => {
  assert.equal(meetingStatusKey({ summaryMd: null, recordingStatuses: ['FAILED'] }), 'FAILED')
  assert.equal(meetingStatusKey({ summaryMd: null, recordingStatuses: ['FAILED', 'FAILED'] }), 'FAILED')
})

test('★ 하나라도 살아 있으면 실패라 부르지 않는다 — 쓸 수 있는 전사가 있다', () => {
  assert.equal(meetingStatusKey({ summaryMd: null, recordingStatuses: ['FAILED', 'TRANSCRIBED'] }), 'TRANSCRIBED')
  assert.equal(meetingStatusKey({ summaryMd: null, recordingStatuses: ['FAILED', 'UPLOADED'] }), 'TRANSCRIBING')
})

test('아직 읽는 중이면 전사 중 — 올라가기만 한 것도 같은 자리다', () => {
  assert.equal(meetingStatusKey({ summaryMd: null, recordingStatuses: ['UPLOADED'] }), 'TRANSCRIBING')
  assert.equal(meetingStatusKey({ summaryMd: null, recordingStatuses: ['TRANSCRIBING'] }), 'TRANSCRIBING')
})

test('다 읽혔으면 전사됨 — 정리는 아직이라는 뜻이다', () => {
  assert.equal(meetingStatusKey({ summaryMd: null, recordingStatuses: ['TRANSCRIBED'] }), 'TRANSCRIBED')
  assert.equal(meetingStatusKey({ summaryMd: null, recordingStatuses: ['SUMMARIZED'] }), 'TRANSCRIBED')
})

test('모든 상태에 사람이 읽는 이름과 색이 있다 — 코드값이 화면에 나오면 개발자 말이다', () => {
  for (const key of MEETING_STATUS_ORDER) {
    const meta = MEETING_STATUS_META[key]
    assert.ok(meta, key)
    assert.ok(meta.label.length > 0, key)
    assert.ok(!/^[A-Z_]+$/.test(meta.label), `${key} 라벨이 코드값이다: ${meta.label}`)
  }
})

test('필터 순서가 사람이 겪는 순서다 — 비었다 → 읽는 중 → 읽었다 → 정리됐다, 실패는 끝', () => {
  assert.deepEqual(MEETING_STATUS_ORDER, ['EMPTY', 'TRANSCRIBING', 'TRANSCRIBED', 'SUMMARIZED', 'FAILED'])
})

test('모르는 조합에서도 화면이 비지 않는다', () => {
  const meta = meetingStatusMeta({ summaryMd: null, recordingStatuses: ['???'] })
  assert.ok(meta.label.length > 0)
})
