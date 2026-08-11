import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CORPUS_FILTER, applyCorpusFilter, isInCorpus, filterCorpus, type CorpusRow } from './corpus.ts'

function r(p: Partial<CorpusRow>): CorpusRow {
  return { source: 'monitoring', is_stat_excluded: false, deleted_at: null, ...p }
}

test('수집함 단건은 통계 모집단에서 제외된다 (설계서 §7.3)', () => {
  assert.equal(isInCorpus(r({ source: 'inbox' })), false)
  assert.equal(isInCorpus(r({ source: 'monitoring' })), true)
})

test('이상치·삭제 플래그가 붙은 행은 제외된다', () => {
  assert.equal(isInCorpus(r({ is_stat_excluded: true })), false)
  assert.equal(isInCorpus(r({ deleted_at: '2026-08-11T00:00:00+09:00' })), false)
})

test('filterCorpus는 세 조건을 모두 적용한다', () => {
  const rows = [
    r({}),
    r({ source: 'inbox' }),
    r({ is_stat_excluded: true }),
    r({ deleted_at: '2026-01-01T00:00:00+09:00' }),
    r({}),
  ]
  assert.equal(filterCorpus(rows).length, 2)
})

test('쿼리 빌더에 세 조건이 정확히 적용된다', () => {
  const calls: string[] = []
  const stub = {
    eq(c: string, v: unknown) { calls.push(`eq:${c}=${String(v)}`); return stub },
    is(c: string, v: unknown) { calls.push(`is:${c}=${String(v)}`); return stub },
  }
  applyCorpusFilter(stub)
  assert.deepEqual(calls, [
    'eq:source=monitoring',
    'eq:is_stat_excluded=false',
    'is:deleted_at=null',
  ])
})

test('코퍼스 조건 상수가 바뀌면 눈에 띈다 (회귀 가드)', () => {
  assert.deepEqual({ ...CORPUS_FILTER }, {
    source: 'monitoring',
    is_stat_excluded: false,
    deleted_at: null,
  })
})
