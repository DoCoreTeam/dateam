import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCommits, classifyType, cleanSubject } from './parse-commits.ts'

test('classifyType — 키워드별', () => {
  assert.equal(classifyType('버그 수정'), 'fix')
  assert.equal(classifyType('GPU 흐름 개선·리팩터'), 'improve')
  assert.equal(classifyType('체인지로그 기능 추가'), 'feature')
})

test('cleanSubject — 버전·claude 꼬리표 제거', () => {
  assert.deepEqual(cleanSubject('v0.7.196: 체인지로그 추가 claude'), { version: '0.7.196', text: '체인지로그 추가' })
  assert.deepEqual(cleanSubject('v0.7.195: multipart 전송'), { version: '0.7.195', text: 'multipart 전송' })
})

test('cleanSubject — merge/revert/형식밖 → null', () => {
  assert.equal(cleanSubject('Merge branch main'), null)
  assert.equal(cleanSubject('Revert "v0.7.1: x"'), null)
  assert.equal(cleanSubject('chore: cleanup'), null)
})

test('parseCommits — 동일 버전 다중 커밋 묶음 + 최신날짜', () => {
  const out = parseCommits([
    { date: '2026-06-18', subject: 'v0.7.195: 끝단 E2E 추가 claude' },
    { date: '2026-06-18', subject: 'v0.7.195: 단일 드롭존 통합 claude' },
    { date: '2026-06-17', subject: 'v0.7.194: 캘린더 명확화 claude' },
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].version, '0.7.195')
  assert.equal(out[0].changes.length, 2)
  assert.equal(out[0].released_at, '2026-06-18')
  assert.equal(out[1].version, '0.7.194')
  assert.equal(out[1].changes.length, 1)
})

test('parseCommits — 최신순 보존 + 비대상 스킵', () => {
  const out = parseCommits([
    { date: '2026-06-18', subject: 'Merge x' },
    { date: '2026-06-18', subject: 'v0.7.196: 신규 기능 claude' },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].version, '0.7.196')
  assert.equal(out[0].type, 'feature')
})
