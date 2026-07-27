import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNonEmptyRich, buildPrevPlanMap, computeCarryForward, type CarryRow } from './carry-forward.ts'

test('isNonEmptyRich: 빈 리치텍스트는 false', () => {
  assert.equal(isNonEmptyRich(''), false)
  assert.equal(isNonEmptyRich('<p></p>'), false)
  assert.equal(isNonEmptyRich('<p><br></p>'), false)
  assert.equal(isNonEmptyRich('   '), false)
  assert.equal(isNonEmptyRich('<p>실제</p>'), true)
})

test('buildPrevPlanMap: 직전 주의 비어있지 않은 계획만, 카테고리별 최초 1건', () => {
  const reports = [
    { week_start: '2026-07-13', category: '영업', plan: '<p>충남 TP 방문</p>' },
    { week_start: '2026-07-13', category: '영업', plan: '<p>중복 무시</p>' },
    { week_start: '2026-07-13', category: '개발', plan: '<p></p>' }, // 빈 계획 제외
    { week_start: '2026-07-06', category: '영업', plan: '<p>더 이전 주</p>' }, // 다른 주 제외
  ]
  const m = buildPrevPlanMap(reports, '2026-07-13')
  assert.equal(m.get('영업'), '<p>충남 TP 방문</p>')
  assert.equal(m.has('개발'), false)
  assert.equal(m.size, 1)
})

test('핵심 재현: 편집 주에 저장된 보고가 없고 직전 주 계획이 있으면 이월 행 추가', () => {
  // 7/20 주 편집: prefill 없음(7/20 보고 미저장), 7/13 계획 존재 → 7/20 성과로 이월.
  const prevPlan = new Map([['영업 및 사업개발', '<p>충남 TP 방문 - 예산 변경관련 논의</p>']])
  const { rows, carriedCount } = computeCarryForward([], prevPlan)
  assert.equal(carriedCount, 1)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].category, '영업 및 사업개발')
  assert.equal(rows[0].performance, '<p>충남 TP 방문 - 예산 변경관련 논의</p>')
  assert.equal(rows[0].plan, '')
})

test('빈 성과 셀만 채우고 작성된 성과는 절대 미덮어씀', () => {
  const prefill: CarryRow[] = [
    { category: '영업', performance: '<p>이미 작성한 성과</p>', plan: '', issues: '' },
    { category: '개발', performance: '<p></p>', plan: '', issues: '' },
  ]
  const prevPlan = new Map([
    ['영업', '<p>전주 영업 계획</p>'],
    ['개발', '<p>전주 개발 계획</p>'],
  ])
  const { rows, carriedCount } = computeCarryForward(prefill, prevPlan)
  assert.equal(rows[0].performance, '<p>이미 작성한 성과</p>') // 미덮어씀
  assert.equal(rows[1].performance, '<p>전주 개발 계획</p>') // 빈 셀만 채움
  assert.equal(carriedCount, 1)
})

test('이월할 전주 계획이 없으면 원본 그대로, carriedCount 0', () => {
  const prefill: CarryRow[] = [{ category: '영업', performance: '<p></p>', plan: '', issues: '' }]
  const { rows, carriedCount } = computeCarryForward(prefill, new Map())
  assert.deepEqual(rows, prefill)
  assert.equal(carriedCount, 0)
})
