// lib/ui/reorder.test.ts — 순서 바꾸기 가드
//
// 사용자 지적(2026-09-08): *"영업단계 위치를 조정할 수 있도록 해줘 지금은 위치 이동이 안되니깐"*
//
// 이 계산은 **조용히 틀린다** — 한 칸 밀리거나, 항목이 사라지거나, 중복된다.
// 그리고 그 결과가 곧바로 서버에 저장되므로 틀리면 데이터가 틀어진다.
// 그래서 계산을 컴포넌트 밖에 두고(E-6) 여기서 잠근다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { moveTo, moveByStep, canMove, orderChanged, dropIndex } from './reorder.ts'

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8')
const A = ['a', 'b', 'c', 'd']

/* ── 옮기기 ──────────────────────────────────────────── */

test('★ 무엇을 옮겨도 항목이 사라지거나 늘지 않는다 — 그대로 서버에 저장된다', () => {
  for (let from = 0; from < A.length; from++) {
    for (let to = 0; to < A.length; to++) {
      const out = moveTo(A, from, to)
      assert.equal(out.length, A.length, `${from}→${to} 에서 개수가 달라졌다`)
      assert.deepEqual([...out].sort(), [...A].sort(), `${from}→${to} 에서 항목이 바뀌었다`)
    }
  }
})

test('앞으로·뒤로 옮기면 그 자리에 들어간다', () => {
  assert.deepEqual(moveTo(A, 0, 2), ['b', 'c', 'a', 'd'])
  assert.deepEqual(moveTo(A, 3, 0), ['d', 'a', 'b', 'c'])
  assert.deepEqual(moveTo(A, 1, 1), A, '제자리는 그대로다')
})

test('원본을 건드리지 않는다 — 화면 상태를 몰래 바꾸면 되돌릴 수 없다', () => {
  const src = [...A]
  moveTo(src, 0, 3)
  assert.deepEqual(src, A)
})

/* ── 드래그로 놓은 자리 — 여기가 한 칸씩 어긋나는 자리다 ── */

test('★ 위쪽 절반에 놓으면 그 항목 앞으로', () => {
  // a b c d 에서 d(3) 를 b(1) 앞에 → a d b c
  assert.deepEqual(moveTo(A, 3, dropIndex(3, 1, false)), ['a', 'd', 'b', 'c'])
})

test('★ 아래쪽 절반에 놓으면 그 항목 뒤로 — 뒤로 옮길 때 한 칸 덜 가면 안 된다', () => {
  // a b c d 에서 a(0) 를 c(2) 뒤에 → b c a d
  assert.deepEqual(moveTo(A, 0, dropIndex(0, 2, true)), ['b', 'c', 'a', 'd'])
  // a(0) 를 d(3) 뒤에 → 맨 끝
  assert.deepEqual(moveTo(A, 0, dropIndex(0, 3, true)), ['b', 'c', 'd', 'a'])
})

test('★ 자기 자신 위에 놓으면 제자리 — 저장하러 가지 않아야 한다', () => {
  for (let i = 0; i < A.length; i++) {
    assert.deepEqual(moveTo(A, i, dropIndex(i, i, false)), A, `${i} 앞에 놓기`)
    assert.deepEqual(moveTo(A, i, dropIndex(i, i, true)), A, `${i} 뒤에 놓기`)
  }
})

test('바로 옆에 놓아도 제자리 — 「앞의 것 뒤에」와 「자기 자리」는 같은 뜻이다', () => {
  // b(1) 를 a(0) 뒤에 놓으면 이미 그 자리다
  assert.deepEqual(moveTo(A, 1, dropIndex(1, 0, true)), A)
  // b(1) 를 c(2) 앞에 놓아도 그 자리다
  assert.deepEqual(moveTo(A, 1, dropIndex(1, 2, false)), A)
})

test('놓는 자리가 어디든 항목이 사라지거나 늘지 않는다', () => {
  for (let from = 0; from < A.length; from++) {
    for (let over = 0; over < A.length; over++) {
      for (const af of [true, false]) {
        const out = moveTo(A, from, dropIndex(from, over, af))
        assert.deepEqual([...out].sort(), [...A].sort(), `${from}→${over}/${af}`)
      }
    }
  }
})

test('목록 밖으로 떨어뜨려도 항목을 잃지 않는다 — 양 끝으로 붙인다', () => {
  assert.deepEqual(moveTo(A, 0, -5), ['a', 'b', 'c', 'd'])
  assert.deepEqual(moveTo(A, 0, 99), ['b', 'c', 'd', 'a'])
  assert.deepEqual(moveTo(A, 99, 0), A, '없는 것을 옮기라 하면 그대로 둔다')
})

test('한 칸씩 — 경계에서는 원본 그대로', () => {
  assert.deepEqual(moveByStep(A, 1, -1), ['b', 'a', 'c', 'd'])
  assert.deepEqual(moveByStep(A, 1, 1), ['a', 'c', 'b', 'd'])
  assert.deepEqual(moveByStep(A, 0, -1), A, '첫 항목을 더 위로 올릴 곳은 없다')
  assert.deepEqual(moveByStep(A, 3, 1), A, '마지막 항목을 더 내릴 곳은 없다')
})

/* ── 못 하는 것은 못 한다고 보여 준다 ─────────────────── */

test('★ 경계에서 버튼을 끈다 — 무반응이 「이 버튼은 고장」으로 읽혔던 자리', () => {
  assert.equal(canMove(0, -1, 4), false, '첫 항목의 ∧ 는 꺼져야 한다')
  assert.equal(canMove(3, 1, 4), false, '마지막 항목의 ∨ 는 꺼져야 한다')
  assert.equal(canMove(0, 1, 4), true)
  assert.equal(canMove(3, -1, 4), true)
  assert.equal(canMove(0, -1, 1), false, '항목이 하나뿐이면 양쪽 다 꺼진다')
  assert.equal(canMove(0, 1, 1), false)
})

/* ── 헛 왕복을 막는다 ────────────────────────────────── */

test('안 달라졌으면 저장하러 가지 않는다 — 헛 왕복·헛 감사기록이 남는다', () => {
  assert.equal(orderChanged(['a', 'b'], ['a', 'b']), false)
  assert.equal(orderChanged(['a', 'b'], ['b', 'a']), true)
  assert.equal(orderChanged(['a'], ['a', 'b']), true)
})

/* ── 배선 — 만들고 안 쓰면 없는 규칙이다 ─────────────── */

const LIST = 'components/ui/ReorderList.tsx'
const PROCESS = 'app/(crm)/crm/process/ProcessClient.tsx'

test('★ 부품이 이 계산을 쓴다 — 핸들러 안에서 다시 세면 검증 수단이 실브라우저뿐이다(E-6)', () => {
  const src = read(LIST)
  for (const fn of ['moveTo', 'moveByStep', 'canMove', 'orderChanged', 'dropIndex']) {
    assert.ok(src.includes(fn), `${fn} 를 안 쓴다`)
  }
  assert.ok(!/splice\(/.test(src), '부품이 직접 배열을 자르면 SSOT 와 갈린다')
  // 드롭 목적지를 보정 없이 넘기면 순서가 한 칸씩 밀린 채 저장된다 —
  // 화면은 그럴듯해 보여서 이 결함은 조용히 지나간다
  assert.match(
    src,
    /moveTo\(movable, from, dropIndex\(from, over, placeAfter\)\)/,
    '드롭 자리를 보정 없이 넘긴다 — 뒤로 옮길 때 한 칸씩 어긋난다',
  )
  assert.ok(
    !/to \+= 1|to -= 1/.test(src),
    '부품이 보정을 다시 계산하면 SSOT 와 갈린다',
  )
})

test('★ 영업 단계가 부품을 쓴다 — 28px 자작 화살표로 되돌아가지 않는다', () => {
  const src = read(PROCESS)
  assert.match(src, /<ReorderList/, '순서 바꾸기를 화면이 다시 만들었다')
  assert.ok(
    !/aria-label="위로"|aria-label="아래로"/.test(src),
    '화면이 자작 화살표를 되살렸다 — 크기·경계 처리가 또 갈린다',
  )
  // 성사·실패는 자리를 못 바꾼다 — 딜을 닫는 칸이라 끝에 있어야 한다
  assert.match(src, /isFixed=\{\(s\) => s\.kind !== 'OPEN'\}/, '고정 항목 규칙이 사라졌다')
})

test('버튼이 터치 최소치를 지킨다 — 22px 로 되돌리면 「안 눌리는 버튼」이 다시 생긴다', () => {
  const css = read('components/ui/reorder-list.module.css')
  assert.match(css, /\.steps \{[^}]*flex-direction: row/, '세로로 쌓으면 각 버튼이 절반 높이가 된다')
  assert.match(css, /\.step \{[^}]*height: var\(--control-h, 44px\)/s, '버튼 높이가 최소치 미만이다')
  assert.match(css, /\.step:disabled/, '못 옮기는 자리를 보여 주지 않으면 무반응으로 읽힌다')
})
