// lib/forms/resync.test.ts — 폼이 서버 값을 따라잡는 방식 + 배선 가드
//
// **왜** (실측 /crm/meetings/[id] v0.7.668): 「원본에 맞추기」로 제목이 바뀌었는데
// 폼은 옛 제목을 들고 있었고, 화면은 그걸 «바뀐 것»으로 보아 「저장」 줄을 띄웠다.
// 그 저장을 누르면 **방금 맞춘 제목이 되돌아간다.** 고친 것을 화면이 되돌리는 상태였다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, stripComments } from '../ui/component-scan.ts'
import { adoptUntouched, sameSnapshot } from './resync.ts'

function code(file: string): string { return stripComments(read(file)) }

const FACTS = 'app/(crm)/crm/meetings/[id]/MeetingFacts.tsx'

// ─────────────────────────────── 판정 자체 ───────────────────────────────

test('손대지 않은 칸은 새 서버 값을 받는다 — 옛 값이 남아 저장이 되돌리는 일이 없게', () => {
  const base = { title: '8/31 미팅', location: '' }
  const incoming = { title: '8/31 김해사업 미팅', location: '' }
  const merged = adoptUntouched(base, incoming, { ...base })
  assert.equal(merged.title, '8/31 김해사업 미팅')
})

test('사용자가 쓰던 칸은 남의 변경으로 덮지 않는다 — 입력 중이던 글이 사라지면 안 된다', () => {
  const base = { title: '8/31 미팅', location: '' }
  const incoming = { title: '8/31 김해사업 미팅', location: '' }
  // 사용자가 장소를 쓰는 중이고 제목도 직접 고쳤다
  const current = { title: '내가 고친 제목', location: '코나아이 회의실' }
  const merged = adoptUntouched(base, incoming, current)
  assert.equal(merged.title, '내가 고친 제목', '사용자가 고친 제목을 서버 값이 덮었다')
  assert.equal(merged.location, '코나아이 회의실', '입력 중이던 장소가 사라졌다')
})

test('한 칸이 바뀌어도 나머지 칸은 그대로 따라간다 — 칸별로 판정한다', () => {
  const base = { title: 'a', location: 'x', companyId: 'c1' }
  const incoming = { title: 'b', location: 'y', companyId: 'c1' }
  const merged = adoptUntouched(base, incoming, { title: '내가 쓴 것', location: 'x', companyId: 'c1' })
  assert.equal(merged.title, '내가 쓴 것')
  assert.equal(merged.location, 'y', '안 건드린 장소는 따라가야 한다')
})

test('원본을 고치지 않는다 — 불변', () => {
  const current = { title: 'a' }
  const merged = adoptUntouched({ title: 'a' }, { title: 'b' }, current)
  assert.equal(current.title, 'a')
  assert.notEqual(merged, current)
})

test('같은 값이면 같다고 본다 — 객체 동일성으로 재면 렌더가 멈추지 않는다', () => {
  // 부모가 value={{...}} 로 매 렌더 새 객체를 만들어도 값이 같으면 «안 바뀜»이어야 한다
  assert.equal(sameSnapshot({ a: '1', b: '2' }, { a: '1', b: '2' }), true)
  assert.equal(sameSnapshot({ a: '1' }, { a: '2' }), false)
  assert.equal(sameSnapshot({ a: '1' }, { a: '1', b: '' }), false)
})

test('빈 문자열과 없는 칸을 구분한다 — 장소를 지운 것과 안 받은 것은 다르다', () => {
  const merged = adoptUntouched({ location: 'x' }, { location: '' }, { location: 'x' })
  assert.equal(merged.location, '', '서버가 비웠으면 폼도 비어야 한다')
})

// ─────────────────────────────── 배선 ───────────────────────────────

test('★ MeetingFacts 는 재동기화를 SSOT 로 한다 — 화면이 자기 방식으로 다시 만들지 않게', () => {
  const src = code(FACTS)
  assert.ok(
    src.includes("from '@/lib/forms/resync'"),
    'MeetingFacts 가 lib/forms/resync 를 안 쓴다 — 폼이 서버 변경을 못 따라간다',
  )
  assert.ok(src.includes('adoptUntouched('), 'adoptUntouched 호출이 없다')
  assert.ok(src.includes('sameSnapshot('), 'sameSnapshot 판정이 없다')
})

test('★ 재동기화가 폼 칸을 전부 덮지 않는다 — 통째 덮기는 입력 중이던 값을 지운다', () => {
  const src = code(FACTS)
  // adoptUntouched 를 거치지 않고 setTitle(value.title) 로 바로 덮으면 사용자 입력이 날아간다
  assert.ok(
    !/setTitle\(value\.title\)/.test(src),
    'setTitle(value.title) 로 무조건 덮고 있다 — 사용자가 쓰던 제목이 사라진다',
  )
  assert.ok(
    !/setLocation\(value\.location/.test(src),
    'setLocation(value.location…) 으로 무조건 덮고 있다 — 입력 중이던 장소가 사라진다',
  )
})
