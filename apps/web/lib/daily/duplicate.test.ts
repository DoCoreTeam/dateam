import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeTitle,
  titleSimilarity,
  findDuplicateCandidates,
  DUPLICATE_THRESHOLD,
} from './duplicate.ts'
import type { DailyLog } from '@/types/database'

// 함수가 실제로 참조하는 필드(id, content, original_input, origin_group_id)만 채운
// 최소 스텁. 나머지 필드는 비교 로직과 무관하므로 단언 캐스트로 생략한다.
function makeLog(partial: Partial<DailyLog> & { id: string }): DailyLog {
  return {
    content: '',
    original_input: null,
    origin_group_id: null,
    ...partial,
  } as DailyLog
}

// ── normalizeTitle ────────────────────────────────────────────
test('normalizeTitle: 대소문자·문장부호·공백 정규화', () => {
  assert.equal(normalizeTitle('  Hello,  WORLD!! '), 'hello world')
})

test('normalizeTitle: 한글 + 문장부호 제거', () => {
  assert.equal(normalizeTitle('A사 견적서 - 발송!!'), 'a사 견적서 발송')
})

// ── titleSimilarity ───────────────────────────────────────────
test('titleSimilarity: 동일 문자열은 1', () => {
  assert.equal(titleSimilarity('견적서 발송', '견적서 발송'), 1)
})

test('titleSimilarity: 문장부호/대소문자만 다르면 1', () => {
  assert.equal(titleSimilarity('견적서, 발송', '견적서 발송!!'), 1)
})

test('titleSimilarity: 부분 겹침은 0~1 사이', () => {
  // {a, b} vs {a, c} → 교집합 1, 합집합 3 → 1/3
  const score = titleSimilarity('a b', 'a c')
  assert.ok(score > 0 && score < 1)
  assert.equal(score, 1 / 3)
})

test('titleSimilarity: 무관한 문자열은 0', () => {
  assert.equal(titleSimilarity('견적서 발송', '점심 회식'), 0)
})

test('titleSimilarity: 빈 문자열은 0', () => {
  assert.equal(titleSimilarity('', '견적서'), 0)
})

// ── findDuplicateCandidates ───────────────────────────────────
test('findDuplicateCandidates: 동일/유사 항목을 임계 초과로 검출', () => {
  const target = makeLog({ id: 't', content: 'A사 견적서 발송' })
  const pool = [
    makeLog({ id: 'dup', content: 'A사 견적서 발송!!' }), // 정규화 후 동일 → 1.0
    makeLog({ id: 'unrelated', content: '점심 회식 예약' }), // 0
  ]
  const result = findDuplicateCandidates(target, pool)
  assert.equal(result.length, 1)
  assert.equal(result[0].log.id, 'dup')
  assert.equal(result[0].score, 1)
})

test('findDuplicateCandidates: 자기 자신은 제외', () => {
  const target = makeLog({ id: 't', content: '견적서 발송' })
  const result = findDuplicateCandidates(target, [target])
  assert.equal(result.length, 0)
})

test('findDuplicateCandidates: 같은 origin_group은 제외(의도적 분해)', () => {
  const target = makeLog({ id: 't', content: '견적서 발송', origin_group_id: 'g1' })
  const sibling = makeLog({ id: 's', content: '견적서 발송', origin_group_id: 'g1' })
  const result = findDuplicateCandidates(target, [sibling])
  assert.equal(result.length, 0)
})

test('findDuplicateCandidates: 다른 origin_group 동일 제목은 검출', () => {
  const target = makeLog({ id: 't', content: '견적서 발송', origin_group_id: 'g1' })
  const other = makeLog({ id: 'o', content: '견적서 발송', origin_group_id: 'g2' })
  const result = findDuplicateCandidates(target, [other])
  assert.equal(result.length, 1)
  assert.equal(result[0].log.id, 'o')
})

test('findDuplicateCandidates: score 내림차순 정렬', () => {
  const target = makeLog({ id: 't', content: 'a b c' })
  const pool = [
    makeLog({ id: 'partial', content: 'a b x' }), // 교집합 2/합집합 4 = 0.5 (임계 미만)
    makeLog({ id: 'exact', content: 'a b c' }), // 1.0
    makeLog({ id: 'high', content: 'a b c d' }), // 교집합 3/합집합 4 = 0.75
  ]
  const result = findDuplicateCandidates(target, pool)
  // 0.5는 기본 임계(0.7) 미만이므로 제외, 1.0·0.75만 남고 내림차순
  assert.equal(result.length, 2)
  assert.equal(result[0].log.id, 'exact')
  assert.equal(result[1].log.id, 'high')
  assert.ok(result[0].score >= result[1].score)
})

test('findDuplicateCandidates: 임계값 파라미터 적용', () => {
  const target = makeLog({ id: 't', content: 'a b' })
  const pool = [makeLog({ id: 'half', content: 'a c' })] // 1/3 ≈ 0.333
  assert.equal(findDuplicateCandidates(target, pool, DUPLICATE_THRESHOLD).length, 0)
  assert.equal(findDuplicateCandidates(target, pool, 0.3).length, 1)
})

test('findDuplicateCandidates: content 없으면 original_input 으로 비교', () => {
  const target = makeLog({ id: 't', content: '', original_input: '견적서 발송' })
  const pool = [makeLog({ id: 'o', content: '견적서 발송' })]
  const result = findDuplicateCandidates(target, pool)
  assert.equal(result.length, 1)
})
