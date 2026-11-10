/**
 * 정리본 고치던 것 임시 저장 가드.
 *
 * 사용자 지적(2026-11-10): 저장이 막힌 뒤 새로고침하자 고친 내용이 통째로 사라졌다.
 * 지키는 것: 사용자별 키, 본 판과 고친 것을 함께 되살림, 만료 손상 빈 것은 버림, 편집기가 실제로 쓰고 지움.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { digestDraftKey, parseDigestDraft, serializeDigestDraft, type DigestDraft } from './digest-draft.ts'
import { DEFAULT_TTL_MS } from '../forms/draft-core.ts'

const draft: DigestDraft = {
  baseSeq: 1,
  digest: { outcome: '회의 결과', nextStep: '', agenda: [{ title: '일정', facts: [{ text: '12월 초', origin: 'transcript', segmentIds: ['s1'] }] }], decisions: [], conflicts: [] },
  edits: [{ path: { kind: 'fact', agenda: 0, fact: 0 }, text: '12월 첫 주' }],
}

test('키는 사용자와 노트로 갈린다', () => {
  assert.notEqual(digestDraftKey('u1', 'n1'), digestDraftKey('u2', 'n1'))
  assert.notEqual(digestDraftKey('u1', 'n1'), digestDraftKey('u1', 'n2'))
  assert.match(digestDraftKey('u1', 'n1'), /u1/)
})

test('본 판과 고친 것을 함께 되살린다', () => {
  const back = parseDigestDraft(serializeDigestDraft(draft, 1000), 2000)
  assert.deepEqual(back, draft)
})

test('만료 손상 빈 고침은 되살리지 않는다', () => {
  assert.equal(parseDigestDraft(serializeDigestDraft(draft, 0), DEFAULT_TTL_MS + 1), null)
  assert.equal(parseDigestDraft('{깨짐', 0), null)
  assert.equal(parseDigestDraft(null, 0), null)
  assert.equal(parseDigestDraft(serializeDigestDraft({ ...draft, edits: [] }, 0), 1), null)
})

test('편집기가 고칠 때마다 쓰고, 저장과 취소에 지우고, 패널이 열 때 되살린다', () => {
  const ed = readFileSync('components/meeting/DigestEditor.tsx', 'utf8')
  assert.match(ed, /localStorage\.setItem\(storageKey, serializeDigestDraft\(/)
  const save = ed.slice(ed.indexOf('async function save()'), ed.indexOf('const field ='))
  assert.match(save, /clearStored\(\)\s*\n\s*onSaved\(/)
  assert.match(ed, /const cancel = \(\) => \{ clearStored\(\); onCancel\(\) \}/)
  assert.match(ed, /useState\(restored\?\.baseSeq \?\? currentSeq\)/)
  const panel = readFileSync('components/meeting/MeetingDigestPanel.tsx', 'utf8')
  assert.match(panel, /parseDigestDraft\(localStorage\.getItem\(digestDraftKey\(draftUserId, noteId\)\)/)
  assert.match(panel, /restored=\{restored\}/)
})
