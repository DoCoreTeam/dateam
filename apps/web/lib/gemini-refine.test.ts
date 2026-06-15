import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMergeContextBlocks } from './weekly-merge-context.ts'

// 취합 컨텍스트 주입 — 지난주 구분/계획·기존 편집본이 프롬프트 블록으로 들어가는지(순수 함수)
test('ctx 없으면 빈 문자열', () => {
  assert.equal(buildMergeContextBlocks(), '')
  assert.equal(buildMergeContextBlocks({}), '')
})

test('prevCategories → 지난주 구분 블록 + 통일 지시 포함', () => {
  const out = buildMergeContextBlocks({ prevCategories: ['영업', '개발'] })
  assert.match(out, /지난주 구분 목록/)
  assert.match(out, /영업/)
  assert.match(out, /통일/)
})

test('prevPlans → 지난주 계획 블록 + 성과 이행 지시', () => {
  const out = buildMergeContextBlocks({ prevPlans: [{ category: '영업', plan: 'A사 미팅' }] })
  assert.match(out, /지난주 계획/)
  assert.match(out, /A사 미팅/)
  assert.match(out, /성과/)
})

test('existingBody → 기존 편집본 블록 + 임의 삭제 금지 지시', () => {
  const out = buildMergeContextBlocks({
    existingBody: [{ category: '영업', performance: '계약 체결', plan: '', issues: '' }],
  })
  assert.match(out, /기존 취합본|편집본/)
  assert.match(out, /계약 체결/)
  assert.match(out, /삭제.*금지|임의 삭제/)
})

test('빈 배열은 블록 미생성', () => {
  assert.equal(buildMergeContextBlocks({ prevCategories: [], prevPlans: [], existingBody: [] }), '')
})

test('세 컨텍스트 동시 → 세 블록 모두 포함', () => {
  const out = buildMergeContextBlocks({
    prevCategories: ['영업'],
    prevPlans: [{ category: '영업', plan: '계획' }],
    existingBody: [{ category: '영업', performance: '성과', plan: '', issues: '' }],
  })
  assert.match(out, /지난주 구분 목록/)
  assert.match(out, /지난주 계획/)
  assert.match(out, /기존 취합본|편집본/)
})
