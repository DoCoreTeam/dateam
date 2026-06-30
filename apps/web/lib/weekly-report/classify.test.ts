import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyTaskSection,
  classifyEventSection,
  isLowConfidence,
  LOW_CONFIDENCE_THRESHOLD,
  FUTURE_INTENT_PATTERNS,
} from './classify.ts'
import type { CalendarInput } from './draft-types.ts'

// 이번주: 2026-06-29(월) ~ 2026-07-05(일) 가정
const WEEK_START = '2026-06-29'

function event(startAt: string): CalendarInput {
  return { id: 'ev', title: 't', startAt, allDay: false }
}

test('classifyTaskSection: FUTURE_INTENT_PATTERNS 전체가 plan으로 분류된다', () => {
  // Arrange/Act/Assert — 패턴 배열에서 항목 제거 시 회귀 감지
  for (const pat of FUTURE_INTENT_PATTERNS) {
    const section = classifyTaskSection({ content: `${pat} 관련 업무`, is_resolved: true })
    assert.equal(section, 'plan', `'${pat}' → plan 이어야 함`)
  }
})

test('classifyEventSection: 잘못된 startAt은 performance로 폴백', () => {
  assert.equal(classifyEventSection(event('not-a-date'), WEEK_START), 'performance')
})

test('classifyTaskSection: content null/undefined도 안전(미래표현 없음 → performance)', () => {
  assert.equal(
    classifyTaskSection({ content: undefined as unknown as string, is_resolved: true }),
    'performance',
  )
})

test('classifyTaskSection: 완료된 일일업무는 performance', () => {
  // Arrange
  const task = { content: '서버 배포 완료', is_resolved: true }
  // Act
  const section = classifyTaskSection(task)
  // Assert
  assert.equal(section, 'performance')
})

test('classifyTaskSection: 미래지향 표현("예정")이 있으면 plan', () => {
  // Arrange
  const task = { content: '다음 주 고객 미팅 예정', is_resolved: true }
  // Act
  const section = classifyTaskSection(task)
  // Assert
  assert.equal(section, 'plan')
})

test('classifyTaskSection: 미해결(is_resolved=false)이면 issues로 우선 분류', () => {
  // Arrange — 미래 표현이 있어도 미해결이 우선
  const task = { content: '결제 버그 — 다음 단계 진행 예정', is_resolved: false }
  // Act
  const section = classifyTaskSection(task)
  // Assert
  assert.equal(section, 'issues')
})

test('classifyEventSection: 이번주 범위 내 과거 일정은 performance', () => {
  // Arrange
  const ev = event('2026-06-30T05:00:00Z') // KST 6/30 14:00, 이번주 내
  // Act
  const section = classifyEventSection(ev, WEEK_START)
  // Assert
  assert.equal(section, 'performance')
})

test('classifyEventSection: 주 종료(7/5) 이후 일정은 plan', () => {
  // Arrange
  const ev = event('2026-07-07T01:00:00Z') // KST 7/7 10:00, 다음주
  // Act
  const section = classifyEventSection(ev, WEEK_START)
  // Assert
  assert.equal(section, 'plan')
})

test('classifyEventSection: 주 마지막날(7/5)은 경계 포함 → performance', () => {
  // Arrange
  const ev = event('2026-07-05T10:00:00Z') // KST 7/5 19:00, 주 마지막날
  // Act
  const section = classifyEventSection(ev, WEEK_START)
  // Assert
  assert.equal(section, 'performance')
})

test('isLowConfidence: 임계값 미만은 낮음', () => {
  // Arrange / Act / Assert
  assert.equal(isLowConfidence({ confidence: LOW_CONFIDENCE_THRESHOLD - 0.01 }), true)
})

test('isLowConfidence: 임계값 이상은 낮음 아님', () => {
  assert.equal(isLowConfidence({ confidence: LOW_CONFIDENCE_THRESHOLD }), false)
})

test('isLowConfidence: null(신뢰도 불명)은 낮음으로 보지 않음', () => {
  assert.equal(isLowConfidence({ confidence: null }), false)
})
