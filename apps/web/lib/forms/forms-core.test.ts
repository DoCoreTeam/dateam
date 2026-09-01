import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftKey, serializeDraft, parseDraft, draftDiffers, shouldPersistDraft, DEFAULT_TTL_MS } from './draft-core.ts'
import { initHistory, pushHistory, undo, redo, canUndo, canRedo, resetHistory } from './history-core.ts'

// ── draft-core ──
test('draftKey: userId 네임스페이스 + new 기본', () => {
  assert.equal(draftKey('u1', 'contact', ''), 'draft:v1:u1:contact:new')
  assert.equal(draftKey('', 'daily', 'r1'), 'draft:v1:anon:daily:r1')
})

test('serializeDraft: 민감필드 제외', () => {
  const s = serializeDraft({ name: 'a', password: 'secret' }, 1000, ['password'])
  const env = JSON.parse(s)
  assert.equal(env.value.password, undefined)
  assert.equal(env.value.name, 'a')
  assert.equal(env.savedAt, 1000)
})

test('parseDraft: TTL 만료면 null', () => {
  const raw = serializeDraft('hello', 0, [])
  assert.equal(parseDraft(raw, DEFAULT_TTL_MS, DEFAULT_TTL_MS + 1), null) // 만료
  assert.ok(parseDraft(raw, DEFAULT_TTL_MS, 1000))                        // 유효
})

test('parseDraft: 손상/빈 입력 null', () => {
  assert.equal(parseDraft(null, 1000, 0), null)
  assert.equal(parseDraft('{bad', 1000, 0), null)
})

test('draftDiffers: 같은 값(민감필드 차이만)은 동일 취급', () => {
  assert.equal(draftDiffers({ a: 1, password: 'x' }, { a: 1, password: 'y' }, ['password']), false)
  assert.equal(draftDiffers({ a: 1 }, { a: 2 }, []), true)
})

// ── history-core ──
test('push/undo/redo 기본 동작', () => {
  let h = initHistory('a')
  h = pushHistory(h, 'b'); h = pushHistory(h, 'c')
  assert.equal(h.present, 'c')
  assert.equal(canUndo(h), true)
  h = undo(h); assert.equal(h.present, 'b')
  h = undo(h); assert.equal(h.present, 'a')
  assert.equal(canUndo(h), false)
  h = redo(h); assert.equal(h.present, 'b')
  assert.equal(canRedo(h), true)
})

test('pushHistory: 동일 present는 무시', () => {
  let h = initHistory('a')
  const h2 = pushHistory(h, 'a')
  assert.equal(h2.past.length, 0)
})

test('pushHistory: 분기 시 future 폐기', () => {
  let h = initHistory('a'); h = pushHistory(h, 'b'); h = undo(h) // present=a, future=[b]
  h = pushHistory(h, 'c')
  assert.equal(h.future.length, 0)
  assert.equal(h.present, 'c')
})

test('pushHistory: maxHistory 캡', () => {
  let h = initHistory(0)
  for (let i = 1; i <= 10; i++) h = pushHistory(h, i, 3)
  assert.ok(h.past.length <= 3)
  assert.equal(h.present, 10)
})

test('resetHistory: 복원 시작점', () => {
  let h = initHistory('a'); h = pushHistory(h, 'b')
  h = resetHistory('restored')
  assert.equal(h.present, 'restored')
  assert.equal(canUndo(h), false)
})

/*
 * 화면을 **열기만 해도** 임시저장본이 사라지던 것을 막는다(실측 v0.7.677).
 * 저장 효과는 마운트 때도 한 번 돈다 — 그때 「서버에서 읽어 온 값」을 그대로 쓰면
 * 복원 배너가 떠 있는 채로 지난 초안이 덮인다. 사용자에게 주어진 시간은 디바운스 0.6초뿐이었다.
 */
test('shouldPersistDraft: 원본과 같은 값은 저장하지 않는다 — 남의 초안을 덮지 않게', () => {
  assert.equal(shouldPersistDraft('<p>회의 내용</p>', '<p>회의 내용</p>'), false)
  assert.equal(shouldPersistDraft({ a: 1 }, { a: 1 }), false)
})

test('shouldPersistDraft: 실제로 고친 값은 저장한다 — 안 그러면 임시저장이 죽는다', () => {
  assert.equal(shouldPersistDraft('<p>회의 내용 추가</p>', '<p>회의 내용</p>'), true)
  assert.equal(shouldPersistDraft({ a: 2 }, { a: 1 }), true)
  assert.equal(shouldPersistDraft('<p>쓴 것</p>', ''), true)
})
