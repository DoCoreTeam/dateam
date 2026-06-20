import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeName, matchAttendees } from './match-attendees.ts'

// ============================================================
// normalizeName
// ============================================================
describe('normalizeName', () => {
  test('trim + 연속 공백 1칸 + 소문자', () => {
    assert.equal(normalizeName('  Hong  Gil Dong  '), 'hong gil dong')
  })

  test('호칭 접미사 님 제거', () => {
    assert.equal(normalizeName('홍길동님'), '홍길동')
  })

  test('호칭 접미사 씨 제거', () => {
    assert.equal(normalizeName('김철수씨'), '김철수')
  })

  test('접미사 없으면 그대로', () => {
    assert.equal(normalizeName('홍길동'), '홍길동')
  })

  test('빈/공백 → 빈 문자열', () => {
    assert.equal(normalizeName(''), '')
    assert.equal(normalizeName('   '), '')
  })
})

// ============================================================
// matchAttendees
// ============================================================
const people = [
  { id: 'u1', name: '홍길동' },
  { id: 'u2', name: '김철수' },
  { id: 'u3', name: '이영희' },
]

describe('matchAttendees', () => {
  test('정확 일치 매칭', () => {
    const r = matchAttendees(['홍길동', '김철수'], people)
    assert.deepEqual(r.matched, [
      { id: 'u1', name: '홍길동' },
      { id: 'u2', name: '김철수' },
    ])
    assert.deepEqual(r.unmatched, [])
  })

  test('외부인 → unmatched(원본 이름 보존)', () => {
    const r = matchAttendees(['홍길동', '박외부'], people)
    assert.deepEqual(r.matched, [{ id: 'u1', name: '홍길동' }])
    assert.deepEqual(r.unmatched, ['박외부'])
  })

  test('공백·대소문자 정규화 후 일치', () => {
    const dup = [{ id: 'a1', name: 'John Doe' }]
    const r = matchAttendees(['  john   doe  '], dup)
    assert.deepEqual(r.matched, [{ id: 'a1', name: 'John Doe' }])
    assert.deepEqual(r.unmatched, [])
  })

  test('호칭 접미사 제거 후 일치 (홍길동님 → 홍길동)', () => {
    const r = matchAttendees(['홍길동님'], people)
    assert.deepEqual(r.matched, [{ id: 'u1', name: '홍길동' }])
  })

  test('동명이인 → 첫 일치 person만', () => {
    const dupes = [
      { id: 'd1', name: '홍길동' },
      { id: 'd2', name: '홍길동' },
    ]
    const r = matchAttendees(['홍길동'], dupes)
    assert.deepEqual(r.matched, [{ id: 'd1', name: '홍길동' }])
  })

  test('matched 중복 id 제거 (같은 이름 2번)', () => {
    const r = matchAttendees(['홍길동', '홍길동님'], people)
    assert.deepEqual(r.matched, [{ id: 'u1', name: '홍길동' }])
  })

  test('unmatched 중복 제거', () => {
    const r = matchAttendees(['박외부', '박외부'], people)
    assert.deepEqual(r.unmatched, ['박외부'])
  })

  test('빈/공백 이름은 스킵', () => {
    const r = matchAttendees(['', '   ', '홍길동'], people)
    assert.deepEqual(r.matched, [{ id: 'u1', name: '홍길동' }])
    assert.deepEqual(r.unmatched, [])
  })

  test('빈 입력 → 빈 결과', () => {
    const r = matchAttendees([], people)
    assert.deepEqual(r.matched, [])
    assert.deepEqual(r.unmatched, [])
  })

  test('people 빈 배열 → 전부 unmatched', () => {
    const r = matchAttendees(['홍길동', '김철수'], [])
    assert.deepEqual(r.matched, [])
    assert.deepEqual(r.unmatched, ['홍길동', '김철수'])
  })
})
