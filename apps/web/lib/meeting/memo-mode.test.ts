// lib/meeting/memo-mode.test.ts — 회의 본문 편집기의 열림 모드 가드
//
// 사용자 지적(v0.7.677): "수정을 눌러야 텍스트 수정이 되는 에디터 모드여야 하지 않아?"
// 상세를 열면 곧바로 커서가 들어가는 편집기였다. 같은 화면 위쪽은
// 「[수정]에서 추가하세요」라고 말하고 있어서 한 화면이 두 가지를 주장했다.
//
// 여기서 잠그는 것은 **세 갈래 전부**다. 하나만 뒤집혀도 사용자가 겪는 사고가 다르다:
//   · 기본이 쓰기로 돌아가면 → 읽다가 조용히 지워진다(5초 뒤 자동저장이라 되돌릴 곳도 없다)
//   · 빈 본문이 읽기로 열리면 → 회의 중에 「수정」을 한 번 더 눌러야 한다
//   · 임시저장본이 읽기 뒤에 숨으면 → 브라우저에 남은 글이 영영 안 돌아온다

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldStartWriting, plainTextLength } from './memo-mode.ts'

test('본문이 있으면 읽기로 연다 — 「수정」을 눌러야 커서가 들어간다', () => {
  assert.equal(shouldStartWriting({ hasBody: true, hasDraft: false }), false)
})

test('본문이 비었으면 바로 쓰기 — 회의 중 받아적기에 관문을 두지 않는다', () => {
  assert.equal(shouldStartWriting({ hasBody: false, hasDraft: false }), true)
})

test('임시저장본이 있으면 본문이 있어도 쓰기 — 복원 배너가 읽기 뒤에 숨으면 안 된다', () => {
  assert.equal(shouldStartWriting({ hasBody: true, hasDraft: true }), true)
  assert.equal(shouldStartWriting({ hasBody: false, hasDraft: true }), true)
})

test('빈 본문 판정은 태그를 뺀 글자로 한다 — Tiptap 은 빈 글에도 <p></p> 를 남긴다', () => {
  // 실측: 새 회의노트의 본문은 서버에 이 모양으로 저장돼 있다.
  assert.equal(plainTextLength('<p></p>'), 0)
  assert.equal(plainTextLength('<p><br></p>'), 0)
  assert.equal(plainTextLength('<p>&nbsp;</p>'), 0)
  assert.equal(plainTextLength(''), 0)

  /*
   * 실측 앵커(E-6) — /meeting-notes/8a6c004d… 의 본문 첫 문단을 그대로 옮겨 왔다.
   * 이 함수는 화면의 「작성 N자」 배지를 만드는 바로 그 식이다(같은 노트 전체 = 118자,
   * 실브라우저에서 배지로 확인). 이 값이 깨지면 계산이 화면에서 떠난 것이다.
   */
  const real = '<p>전자기기인데 방폭 인증을 받은적이 있는?</p>'
  assert.equal(plainTextLength(real), 22)
  assert.equal(shouldStartWriting({ hasBody: plainTextLength(real) > 0, hasDraft: false }), false)
})
