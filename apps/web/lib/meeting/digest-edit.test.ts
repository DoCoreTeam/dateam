/**
 * 정리본 사람 고치기 가드.
 *
 * 사용자 지시(2026-10-21): 한 글자 오타에 AI 를 다시 돌리는 것은 손해다 — 그 자리에서 고친다.
 * 지키는 것: 글자만 바뀌고 근거와 출처는 그대로, 바뀐 줄에만 「사람」 표시, 없는 자리는 거절.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyDigestEdits, parseDigestEdits, MAX_EDIT_CHARS } from './digest-edit.ts'
import { parseStoredDigest, type DigestResult } from './digest.ts'

const base: DigestResult = {
  outcome: '통합 1식으로 발주하기로 함',
  nextStep: 'swit.or.kr 확인',
  agenda: [
    { title: '사업 예산', facts: [
      { text: '예산은 13억 원', origin: 'transcript', segmentIds: ['s1', 's2'] },
      { text: 'swit.or.kr 에서 확인', origin: 'memo', segmentIds: [] },
    ] },
    { title: '일정', facts: [{ text: '마감 10월 23일', origin: 'both', segmentIds: ['s3'] }] },
  ],
  decisions: [{ text: '3개 업체 자료 받기', origin: 'transcript', segmentIds: ['s4'] }],
  conflicts: [{ memo: 'swit.or.kr', transcript: 'swit.org.kr', segmentIds: ['s5'] }],
}

test('한 글자만 고치면 그 줄만 바뀌고 근거와 출처는 그대로다', () => {
  const out = applyDigestEdits(base, [{ path: { kind: 'fact', agenda: 0, fact: 1 }, text: 'swit.org.kr 에서 확인' }])
  assert.ok(out.ok)
  if (!out.ok) return
  assert.equal(out.changed, 1)
  const f = out.digest.agenda[0].facts[1]
  assert.equal(f.text, 'swit.org.kr 에서 확인')
  assert.equal(f.edited, true)
  assert.equal(f.origin, 'memo')
  assert.deepEqual(out.digest.agenda[0].facts[0], base.agenda[0].facts[0])
  assert.equal(out.digest.agenda[0].facts[0].edited, undefined)
  assert.deepEqual(out.digest.conflicts, base.conflicts)
  // 기준 판은 안 바뀐다
  assert.equal(base.agenda[0].facts[1].text, 'swit.or.kr 에서 확인')
})

test('글이 같으면 바뀐 것으로 세지 않고 표시도 안 단다', () => {
  const out = applyDigestEdits(base, [{ path: { kind: 'fact', agenda: 0, fact: 0 }, text: ' 예산은 13억 원 ' }])
  assert.ok(out.ok && out.changed === 0 && out.digest.agenda[0].facts[0].edited === undefined)
})

test('사실을 비우면 빠지고, 다 빠진 안건도 빠진다', () => {
  const out = applyDigestEdits(base, [{ path: { kind: 'fact', agenda: 1, fact: 0 }, text: '  ' }])
  assert.ok(out.ok)
  if (!out.ok) return
  assert.equal(out.digest.agenda.length, 1)
  assert.equal(out.changed, 1)
})

test('제목·결론·다음 할 일·결정도 고친다', () => {
  const out = applyDigestEdits(base, [
    { path: { kind: 'agendaTitle', agenda: 1 }, text: '일정 관리' },
    { path: { kind: 'outcome' }, text: '통합 1식 발주로 정함' },
    { path: { kind: 'nextStep' }, text: 'swit.org.kr 확인' },
    { path: { kind: 'decision', index: 0 }, text: '3개 업체 차별화 자료 받기' },
  ])
  assert.ok(out.ok)
  if (!out.ok) return
  assert.equal(out.changed, 4)
  assert.equal(out.digest.agenda[1].title, '일정 관리')
  assert.equal(out.digest.decisions[0].edited, true)
  assert.deepEqual(out.digest.decisions[0].segmentIds, ['s4'])
})

test('없는 자리와 빈 안건 제목은 거절한다', () => {
  assert.equal(applyDigestEdits(base, [{ path: { kind: 'fact', agenda: 5, fact: 0 }, text: 'x' }]).ok, false)
  assert.equal(applyDigestEdits(base, [{ path: { kind: 'decision', index: 9 }, text: 'x' }]).ok, false)
  assert.equal(applyDigestEdits(base, [{ path: { kind: 'agendaTitle', agenda: 0 }, text: ' ' }]).ok, false)
})

test('요청 모양 검사 — 근거나 출처를 실어 보내는 자리가 없다', () => {
  assert.equal(parseDigestEdits([]).ok, false)
  assert.equal(parseDigestEdits([{ path: { kind: 'fact', agenda: 0 }, text: 'x' }]).ok, false)
  assert.equal(parseDigestEdits([{ path: { kind: 'fact', agenda: -1, fact: 0 }, text: 'x' }]).ok, false)
  assert.equal(parseDigestEdits([{ path: { kind: 'outcome' }, text: 'x'.repeat(MAX_EDIT_CHARS + 1) }]).ok, false)
  const ok = parseDigestEdits([{ path: { kind: 'fact', agenda: 0, fact: 1 }, text: 'y', segmentIds: ['evil'], origin: 'transcript' }])
  assert.ok(ok.ok)
  if (!ok.ok) return
  assert.deepEqual(Object.keys(ok.edits[0]).sort(), ['path', 'text'])
})

test('저장해 둔 판을 되읽어도 「사람」 표시가 남는다', () => {
  const out = applyDigestEdits(base, [{ path: { kind: 'decision', index: 0 }, text: '바꿈' }])
  assert.ok(out.ok)
  if (!out.ok) return
  const back = parseStoredDigest(JSON.parse(JSON.stringify(out.digest)), '')
  assert.equal(back.decisions[0].edited, true)
  const facts = parseStoredDigest(JSON.parse(JSON.stringify(applyDigestEdits(base, [{ path: { kind: 'fact', agenda: 0, fact: 0 }, text: '예산 13억' }]))).digest, '')
  assert.equal(facts.agenda[0].facts[0].edited, true)
})

test('저장 창구는 로그인과 주인을 확인하고 고침 목록만 받는다', async () => {
  const { readFileSync } = await import('node:fs')
  const route = readFileSync('app/api/meeting-notes/[id]/digest/route.ts', 'utf8')
  const put = route.slice(route.indexOf('export async function PUT'))
  assert.match(put, /auth\.getUser\(\)/)
  assert.match(put, /status: 401/)
  assert.match(put, /parseDigestEdits\(body\.edits\)/)
  assert.match(put, /saveEditedDigest\(id, user\.id, body\.baseSeq, parsed\.edits\)/)
  const run = readFileSync('lib/meeting/digest-run.ts', 'utf8')
  const save = run.slice(run.indexOf('export async function saveEditedDigest'), run.indexOf('export interface DigestVersion'))
  assert.match(save, /\.eq\('user_id', userId\)/)
  assert.match(save, /latest\.seq !== baseSeq/)
  assert.match(save, /applyDigestEdits\(latest\.digest, edits\)/)
  assert.doesNotMatch(save, /callGeminiJson|summarizeMeeting/)
})
