import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { visibleExternals, attendeeNamesForSave } from './attendee-chips.ts'

/**
 * 앵커는 **실브라우저에서 잰 한 쌍**이다(E-6).
 * 2026-09-05 · /meeting-notes/8a6c004d… 「방폭전자기기 쪽 업체 찾기 - 슬레노」
 *   저장된 attendees = {김도현, 곽수영, "슬레노 김현택 팀장"}
 *   이어진 인물     = 곽수영(제일엔지니어링 · cmswrqjw90106z9na0n254uda)
 *   그때 화면은 「곽수영 제일엔지니어링」과 「곽수영」을 **둘 다** 그렸다 — 그게 결함이었다.
 */
const REAL_ATTENDEES = ['김도현', '곽수영', '슬레노 김현택 팀장']
const REAL_MEMBERS = ['김도현']
const REAL_LINKED = ['곽수영']
/** 조직원을 뺀 나머지 — 화면이 externals 로 들고 있는 값 */
const REAL_EXTERNALS = ['곽수영', '슬레노 김현택 팀장']

test('실측 앵커 — 이어진 사람은 글자 칩으로 또 나오지 않는다', () => {
  assert.deepEqual(visibleExternals(REAL_EXTERNALS, REAL_LINKED), ['슬레노 김현택 팀장'])
})

test('실측 앵커 — 저장하면 이름이 한 번씩만 들어간다', () => {
  const saved = attendeeNamesForSave(REAL_MEMBERS, REAL_LINKED, REAL_EXTERNALS)
  assert.deepEqual(saved, REAL_ATTENDEES, '화면에서 실제로 저장된 값과 같아야 한다')
  assert.equal(saved.filter((n) => n === '곽수영').length, 1, '곽수영은 한 번만')
})

test('이어진 사람이 없으면 그대로 둔다', () => {
  assert.deepEqual(visibleExternals(REAL_EXTERNALS, []), REAL_EXTERNALS)
})

test('이어진 사람만 있고 글자가 없어도 된다', () => {
  assert.deepEqual(visibleExternals([], ['곽수영']), [])
  assert.deepEqual(attendeeNamesForSave(['김도현'], ['곽수영'], []), ['김도현', '곽수영'])
})

test('아무도 없으면 빈 배열', () => {
  assert.deepEqual(attendeeNamesForSave([], [], []), [])
})

test('여러 명을 이어도 각각 한 번씩만', () => {
  const saved = attendeeNamesForSave(['김도현'], ['곽수영', '서명균'], ['곽수영', '서명균', '진경선 교수'])
  assert.deepEqual(saved, ['김도현', '곽수영', '서명균', '진경선 교수'])
})

/**
 * 화면이 이 계산을 실제로 쓰는지 본다.
 *
 * 계산만 맞고 화면이 옛 방식으로 돌아가면 가드는 통과하는데 사고는 재발한다 —
 * 그게 「자기 상수로 자기를 검사하는 가드」다.
 */
test('MeetingEditor 가 순서 의존으로 되돌아가지 않았다', () => {
  const src = readFileSync(new URL('../../app/(member)/meeting-notes/MeetingEditor.tsx', import.meta.url), 'utf8')

  assert.ok(
    /const visibleExternals = useMemo\(/.test(src),
    '이어진 사람 빼기는 파생값(useMemo)이어야 한다 — 비동기 콜백 안에서 하면 도착 순서에 갈린다',
  )
  assert.ok(
    !/setExternals\(\(prev\)/.test(src),
    'setExternals(prev => …) 로 되돌아갔다 — 이것이 칩이 두 개로 뜨던 그 코드다',
  )
  assert.ok(
    /externals=\{visibleExternals\}/.test(src),
    '자식에 넘기는 것은 원본이 아니라 걸러진 값이어야 한다',
  )
  assert.ok(
    /\.\.\.persons\.map\(\(p\) => p\.name\), \.\.\.visibleExternals\]/.test(src),
    '저장도 걸러진 값을 써야 한다 — 원본을 쓰면 이름이 두 번 저장된다',
  )
})
