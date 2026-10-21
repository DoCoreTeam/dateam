/**
 * 이 회의에 묻기 가드 — 출처 없이 답하지 않는다, 고칠 줄 제안은 정리본 「수정」의 문을 지난 것만.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { DigestResult } from './digest.ts'
import {
  ASK_MAX_QUESTION_CHARS, ASK_NOT_FOUND, ASK_TRANSCRIPT_MAX_CHARS,
  buildAskPrompt, keepValidSuggestions, parseAskAnswer, parseAskQuestion, transcriptForAsk,
} from './ask.ts'

const digest: DigestResult = {
  outcome: '예산 13억 확정',
  nextStep: '자료 받기',
  agenda: [{ title: '예산', facts: [{ text: '외부 연계 3억', origin: 'transcript', segmentIds: ['s1'] }] }],
  decisions: [{ text: '1식 발주', origin: 'both', segmentIds: ['s2'] }],
  conflicts: [],
}
const known = new Set(['s1', 's2'])
const memo = '조달청 접수 마감은 10월 23일이다'
const ctx = { knownIds: known, memo, digest, partial: false }

test('빈 질문과 상한을 넘는 질문은 거절한다', () => {
  assert.equal(parseAskQuestion({ question: '   ' }).ok, false)
  assert.equal(parseAskQuestion(null).ok, false)
  assert.equal(parseAskQuestion({ question: 'x'.repeat(ASK_MAX_QUESTION_CHARS + 1) }).ok, false)
  assert.deepEqual(parseAskQuestion({ question: ' 마감일? ' }), { ok: true, question: '마감일?' })
})

test('근거 id 는 실제 전사 id 만 남는다', () => {
  const a = parseAskAnswer({ found: true, answer: '3억', segmentIds: ['s1', 'made-up', 's1'] }, ctx)
  assert.deepEqual(a.segmentIds, ['s1'])
  assert.equal(a.found, true)
})

test('근거가 하나도 안 서면 답을 버리고 모른다로 바꾼다', () => {
  const a = parseAskAnswer({ found: true, answer: '그럴듯한 답', segmentIds: ['made-up'], memoQuotes: ['메모에 없는 말입니다'] }, ctx)
  assert.equal(a.found, false)
  assert.equal(a.answer, ASK_NOT_FOUND)
  assert.deepEqual(a.suggestions, [])
  assert.equal(parseAskAnswer({ found: false, answer: '', segmentIds: ['s1'] }, ctx).answer, ASK_NOT_FOUND)
  assert.equal(parseAskAnswer('not json', ctx).found, false)
})

test('메모 인용은 메모에 글자 그대로 있을 때만 근거가 된다, 짧은 조각은 안 된다', () => {
  const a = parseAskAnswer({ found: true, answer: '10월 23일', memoQuotes: ['접수 마감은 10월 23일', '마감'] }, ctx)
  assert.equal(a.found, true)
  assert.deepEqual(a.memoQuotes, ['접수 마감은 10월 23일'])
})

test('고칠 줄 제안은 parseDigestEdits 와 applyDigestEdits 를 지난 것만, 같은 글은 뺀다', () => {
  const s = keepValidSuggestions([
    { path: { kind: 'fact', agenda: 0, fact: 0 }, text: '외부 연계 약 3억' },
    { path: { kind: 'fact', agenda: 5, fact: 0 }, text: '없는 줄' },
    { path: { kind: 'nope' }, text: '모양 틀림' },
    { path: { kind: 'outcome' }, text: '예산 13억 확정' },
    { path: { kind: 'agendaTitle', agenda: 0 }, text: '' },
    { path: { kind: 'decision', index: 0 }, text: '' },
  ], digest)
  assert.deepEqual(s.map((x) => [x.edit.path.kind, x.before, x.after]), [
    ['fact', '외부 연계 3억', '외부 연계 약 3억'],
    ['decision', '1식 발주', ''],
  ])
  assert.deepEqual(keepValidSuggestions([{ path: { kind: 'outcome' }, text: 'x' }], null), [])
})

test('전사가 상한을 넘으면 앞에서 자르고 일부만 봤다고 표시한다', () => {
  const long = Array.from({ length: 2000 }, (_, i) => ({ id: `id${i}`, speaker: '화자', text: '가'.repeat(60) }))
  const t = transcriptForAsk(long)
  assert.equal(t.partial, true)
  assert.ok(t.text.length <= ASK_TRANSCRIPT_MAX_CHARS)
  const p = buildAskPrompt({ question: 'q', memo: '', segments: long.slice(0, 2), digest })
  assert.equal(p.partial, false)
  assert.match(p.prompt, /\[id0\] 화자:/)
  assert.match(p.prompt, /\{"kind":"fact","agenda":0,"fact":0\} 외부 연계 3억/)
})

test('창구: 로그인부터 묻고, 노트는 사람의 권한으로 먼저 읽고, 서비스롤은 키 읽기에만 쓴다', () => {
  const route = readFileSync(new URL('../../app/api/meeting-notes/[id]/ask/route.ts', import.meta.url), 'utf8')
  assert.match(route, /auth\.getUser\(\)/)
  assert.match(route, /status: 401/)
  assert.doesNotMatch(route, /attempts/, '오류에 내부 시도 목록을 싣지 않는다')
  const run = readFileSync(new URL('./ask-run.ts', import.meta.url), 'utf8')
  assert.match(run, /^import 'server-only'/m)
  const rls = run.indexOf(".from('meeting_notes')")
  const admin = run.indexOf('createAdminClient()')
  assert.ok(rls > 0 && admin > rls, 'RLS 로 노트를 읽은 뒤에만 서비스롤')
  assert.match(run, /feature: 'meeting\/ask'/)
})
