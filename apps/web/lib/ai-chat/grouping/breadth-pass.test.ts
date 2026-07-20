import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBreadthPrompt, parseBreadthProposals, toBreadthCandidates } from './breadth-pass.ts'

test('buildBreadthPrompt: 문서유형·기존 그룹 제목·원문이 프롬프트에 들어간다', () => {
  const prompt = buildBreadthPrompt('원문 전체 내용', 'requirements', ['1. 사용자 인증', '2. 결제'])
  assert.match(prompt, /요구사항정의서/)
  assert.match(prompt, /사용자 인증/)
  assert.match(prompt, /원문 전체 내용/)
})

test('buildBreadthPrompt: 기존 그룹이 없으면 "(없음)"', () => {
  const prompt = buildBreadthPrompt('원문', 'plan', [])
  assert.match(prompt, /\(없음\)/)
})

test('buildBreadthPrompt: 원문이 상한을 넘으면 절단', () => {
  const long = 'x'.repeat(20_000)
  const prompt = buildBreadthPrompt(long, 'other', [], 100)
  assert.ok(prompt.length < 20_000)
})

test('parseBreadthProposals: 정상 배열 파싱', () => {
  const raw = JSON.stringify(['보안 요구사항', '성능 요구사항'])
  assert.deepEqual(parseBreadthProposals(raw), ['보안 요구사항', '성능 요구사항'])
})

test('parseBreadthProposals: 코드펜스 방어', () => {
  const raw = '```json\n["누락된 안건"]\n```'
  assert.deepEqual(parseBreadthProposals(raw), ['누락된 안건'])
})

test('parseBreadthProposals: 실패 시 빈 배열(보조 기능 폴백 안전)', () => {
  assert.deepEqual(parseBreadthProposals('이건 JSON이 아님'), [])
  assert.deepEqual(parseBreadthProposals('{"not":"array"}'), [])
})

test('toBreadthCandidates: 빈 문자열·중복 제거, status=proposed 고정', () => {
  const candidates = toBreadthCandidates(['A', '', 'A', '  B  ', 'B'])
  assert.deepEqual(candidates, [
    { title: 'A', status: 'proposed' },
    { title: 'B', status: 'proposed' },
  ])
})
