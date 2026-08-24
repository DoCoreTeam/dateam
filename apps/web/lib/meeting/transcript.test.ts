// lib/meeting/transcript.test.ts — 전사 읽기 SSOT 단위 가드
//
// 왜 필요한가: 전사는 마이그 217 부터 쌓이는데 읽는 화면이 없어 **아무도 이 데이터를 안 봤다**.
// 화면이 생기는 순간 정렬·구간 묶기·시각 표기가 전부 사용자 눈에 나온다.
// 특히 `start_ms` 에 구간 오프셋이 이미 더해져 있다는 계약(마이그 217)이 깨지면
// 두 번째 구간부터 시각이 0 으로 되돌아가는데, 화면만 보면 그럴듯해서 안 잡힌다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  segmentsToPlain, groupSegmentsByPart, formatSegmentTime,
  distinctSpeakers, transcriptMinutes, type TranscriptSegment,
} from './transcript.ts'
import { parseSpeakerLines, UNKNOWN_SPEAKER } from './paste-transcript.ts'

function seg(over: Partial<TranscriptSegment>): TranscriptSegment {
  return {
    id: 's1', partId: 'p0', partIdx: 0, idx: 0,
    speaker: '화자1', startMs: 0, endMs: 1000, text: '말',
    ...over,
  }
}

test('평문은 `화자: 말` 줄로 잇는다 — AI 입력과 내보내기가 같은 모양을 쓴다', () => {
  const out = segmentsToPlain([
    seg({ speaker: '김대표', text: '예산은 3억입니다' }),
    seg({ id: 's2', speaker: '윤수석', text: '보안 검토가 남았어요' }),
  ])
  assert.equal(out, '김대표: 예산은 3억입니다\n윤수석: 보안 검토가 남았어요')
})

test('구간별 묶기는 partIdx 오름차순이고 오프셋을 함께 준다', () => {
  const groups = groupSegmentsByPart([
    seg({ id: 'b', partIdx: 1, partId: 'p1', startMs: 600_000 }),
    seg({ id: 'a', partIdx: 0, partId: 'p0', startMs: 0 }),
    seg({ id: 'c', partIdx: 1, partId: 'p1', startMs: 601_000 }),
  ])
  assert.deepEqual(groups.map((g) => g.partIdx), [0, 1])
  assert.deepEqual(groups.map((g) => g.segments.length), [1, 2])
  // 구간 1의 오프셋은 10분 — 이 값이 어긋나면 정리 AI 의 근거 시각이 통째로 밀린다
  assert.equal(groups[1].offsetMs, 10 * 60 * 1000)
})

test('시각 표기 — 한 시간을 넘으면 시간까지 보여 준다', () => {
  assert.equal(formatSegmentTime(0), '00:00')
  assert.equal(formatSegmentTime(63_000), '01:03')
  assert.equal(formatSegmentTime(3_723_000), '1:02:03')
  // 음수는 있을 수 없지만 들어와도 화면이 깨지지 않아야 한다
  assert.equal(formatSegmentTime(-5), '00:00')
})

test('화자 목록은 등장 순서대로, 중복 없이', () => {
  const out = distinctSpeakers([
    seg({ speaker: '윤수석' }), seg({ id: '2', speaker: '김대표' }),
    seg({ id: '3', speaker: '윤수석' }),
  ])
  assert.deepEqual(out, ['윤수석', '김대표'])
})

test('전사 길이는 마지막 끝 시각으로 잰다 (구간 수가 아니라)', () => {
  const segs = [seg({ endMs: 0 }), seg({ id: '2', partIdx: 3, endMs: 2_280_000 })]
  assert.equal(transcriptMinutes(segs, []), 38)
})

test('세그먼트가 없으면 구간 길이 합으로 떨어진다 — 전사 전에도 "몇 분"을 말할 수 있어야 한다', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts = [{ duration_sec: 600 }, { duration_sec: 300 }] as any
  assert.equal(transcriptMinutes([], parts), 15)
})

// ── 붙여넣기 파서 (SSOT — CRM 어댑터와 회의노트 API 가 둘 다 여기를 쓴다) ──

test('`이름: 말` 이면 화자를 갈라 읽는다 (전각 콜론 포함)', () => {
  const out = parseSpeakerLines('김대표: 예산은 3억\n윤수석：보안 검토')
  assert.deepEqual(out.map((l) => [l.speaker, l.text]), [
    ['김대표', '예산은 3억'],
    ['윤수석', '보안 검토'],
  ])
})

test('화자를 못 읽으면 지어내지 않는다', () => {
  const out = parseSpeakerLines('그냥 한 줄짜리 메모')
  assert.equal(out[0].speaker, UNKNOWN_SPEAKER)
  assert.equal(out[0].text, '그냥 한 줄짜리 메모')
})

test('이름이 20자를 넘으면 그건 이름이 아니라 문장이다', () => {
  const long = '가'.repeat(21)
  const out = parseSpeakerLines(`${long}: 뒤에 오는 말`)
  assert.equal(out[0].speaker, UNKNOWN_SPEAKER)
  assert.equal(out[0].text, `${long}: 뒤에 오는 말`)
})

test('빈 줄은 버리고 순서는 유지한다', () => {
  const out = parseSpeakerLines('\n  \nA: 하나\n\nB: 둘\n')
  assert.deepEqual(out.map((l) => l.idx), [0, 1])
  assert.deepEqual(out.map((l) => l.speaker), ['A', 'B'])
})

test('end_ms 는 항상 start_ms 보다 크다 — DB CHECK(마이그 217)를 코드가 먼저 지킨다', () => {
  for (const l of parseSpeakerLines('A: 하나\nB: 둘\nC: 셋')) {
    assert.ok(l.endMs > l.startMs, `구간 ${l.idx} 가 CHECK 를 어긴다`)
  }
})
