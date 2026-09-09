/**
 * 제안서 목차와 전략 가드 (설계서 F9)
 *
 * 여기서 잠그는 것 셋
 * - 목차가 평가 기준 배점에서 파생되는가
 * - 목차 항목이 근거 요구사항 ID 를 갖는가
 * - 전략이 적합도 판정의 강점과 갭을 그대로 받는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildOutline, matchRequirements, pagesFor, uncoveredRequirements,
  FALLBACK_SECTIONS, type EvaluationCriterion,
} from './outline.ts'
import { buildStrategy, STRENGTH_RATIO } from './strategy.ts'
import { SOFT_WEIGHTS, type Assessment, type HardCheck } from '../fit/assess.ts'
import type { Requirement } from '../structure/requirements.ts'
import type { Anomaly } from '../anomaly/engine.ts'

const 요구 = (code: string, kind: Requirement['kind']): Requirement => ({
  code, kind, title: `${code} 요구`, description: '', blockId: 'b1', tableId: 't1', rowNo: 1, extra: {},
})

const 요구사항: Requirement[] = [
  요구('SFR-001', 'functional'),
  요구('SFR-002', 'functional'),
  요구('PER-001', 'performance'),
  요구('SER-001', 'security'),
]

const 배점: EvaluationCriterion[] = [
  { name: '기능 구현의 충실성', points: 30, blockId: 'b10' },
  { name: '보안 대책', points: 20, blockId: 'b11' },
  { name: '성능 확보 방안', points: 10, blockId: 'b12' },
]

// 목차

test('배점표 순서로 목차를 만든다', () => {
  const outline = buildOutline({ criteria: 배점, requirements: 요구사항 })
  // 배점표에 있는 장이 목차에 없으면 평가위원이 점수를 줄 자리를 못 찾는다
  assert.deepEqual(outline.map((o) => o.title), ['기능 구현의 충실성', '보안 대책', '성능 확보 방안'])
  assert.deepEqual(outline.map((o) => o.points), [30, 20, 10])
})

test('배점이 큰 것이 앞에 온다', () => {
  const outline = buildOutline({
    criteria: [
      { name: '작은 것', points: 5, blockId: null },
      { name: '큰 것', points: 50, blockId: null },
    ],
    requirements: [],
  })
  // 평가위원이 먼저 보는 자리다
  assert.equal(outline[0].title, '큰 것')
})

test('목차 항목이 근거 요구사항 ID 를 갖는다', () => {
  const outline = buildOutline({ criteria: 배점, requirements: 요구사항 })
  const 기능 = outline.find((o) => o.title === '기능 구현의 충실성')!
  // 안 달면 다음 사업에서 이 목차를 그대로 복사하고 그 사업 배점표와 어긋난다
  assert.deepEqual(기능.requirementCodes.sort(), ['SFR-001', 'SFR-002'])
  assert.deepEqual(outline.find((o) => o.title === '보안 대책')!.requirementCodes, ['SER-001'])
  assert.equal(기능.criterion, '기능 구현의 충실성')
})

test('배점 이름과 요구사항 종류를 말로 맞춘다', () => {
  assert.deepEqual(matchRequirements('기능 구현', 요구사항).map((r) => r.code), ['SFR-001', 'SFR-002'])
  assert.deepEqual(matchRequirements('보안 대책', 요구사항).map((r) => r.code), ['SER-001'])
  assert.deepEqual(matchRequirements('사업 이해도', 요구사항), [])
})

test('배점 비율로 쪽을 나눈다', () => {
  const outline = buildOutline({ criteria: 배점, requirements: 요구사항, maxPages: 60 })
  // 30점짜리에 두 쪽 쓰면 점수를 못 받는다
  assert.equal(outline[0].suggestedPages, 30)
  assert.equal(outline[1].suggestedPages, 20)
  assert.equal(outline[2].suggestedPages, 10)
})

test('분량 상한이 없으면 쪽을 안 나눈다', () => {
  const outline = buildOutline({ criteria: 배점, requirements: 요구사항 })
  assert.equal(outline[0].suggestedPages, null)
  assert.equal(pagesFor(30, 60, null), null)
  assert.equal(pagesFor(0, 60, 10), null)
})

test('배점표가 없으면 관행 목차를 쓴다', () => {
  const outline = buildOutline({ criteria: [], requirements: 요구사항 })
  assert.equal(outline.length, FALLBACK_SECTIONS.length)
  assert.equal(outline[0].title, '사업 이해')
  // 관행 목차에도 요구사항을 나눠 붙인다
  const 기능 = outline.find((o) => o.title === '기능 요구사항 대응')!
  assert.deepEqual(기능.requirementCodes.sort(), ['SFR-001', 'SFR-002'])
})

test('다루지 않은 요구사항을 알려 준다', () => {
  const outline = buildOutline({
    criteria: [{ name: '기능 구현', points: 30, blockId: null }],
    requirements: 요구사항,
  })
  // 제안서에 빠지면 감점이다
  assert.deepEqual(uncoveredRequirements(outline, 요구사항).map((r) => r.code).sort(), ['PER-001', 'SER-001'])
})

// 전략

const 하드 = (over: Partial<HardCheck> = {}): HardCheck => ({
  requirement: { text: '유사 실적 5건 이상', blockId: 'b1' },
  type: 'record_count', result: 'unmet', profileBasis: '실적 2건', coverableByPartner: true, ...over,
})

function 판정(over: Partial<Assessment> = {}): Assessment {
  return {
    verdict: 'partial', conditional: false, score: 62,
    parts: { capability: 36, trackRecord: 5, scale: 13, risk: -2, competition: 5 },
    hardChecks: [], summary: { met: 0, unmet: 0, unknown: 0 }, gaps: [],
    profileVersion: 3, reportVersion: 1, ...over,
  }
}

test('강점과 갭을 판정에서 그대로 받는다', () => {
  const s = buildStrategy(판정(), [], SOFT_WEIGHTS as unknown as Record<string, number>)
  // 다시 계산하면 판정 화면과 제안 화면이 다른 말을 한다
  assert.ok(s.emphasize.some((p) => p.point === '역량 적합'))
  assert.ok(s.fill.some((p) => p.point === '실적 유사도'))
  assert.equal(s.score, 62)
  assert.equal(s.verdict, 'partial')
})

test('강점 기준이 가중치 대비 비율이다', () => {
  const 낮음 = buildStrategy(
    판정({ parts: { capability: 10, trackRecord: 5, scale: 3, risk: 0, competition: 1 } }),
    [], SOFT_WEIGHTS as unknown as Record<string, number>,
  )
  assert.deepEqual(낮음.emphasize, [])
  assert.ok(STRENGTH_RATIO > 0.5)
})

test('하드 제약 미충족이 가장 급한 갭이다', () => {
  const s = buildStrategy(판정({ hardChecks: [하드()] }), [], SOFT_WEIGHTS as unknown as Record<string, number>)
  // 못 채우면 아예 못 낸다
  assert.equal(s.fill[0].point, '유사 실적 5건 이상')
  assert.match(s.fill[0].basis, /파트너 역량으로 채울 수 있다/)
})

test('파트너로 채울 수 있으면 컨소시엄을 권한다', () => {
  const s = buildStrategy(판정({ hardChecks: [하드()] }), [], SOFT_WEIGHTS as unknown as Record<string, number>)
  assert.equal(s.consortiumNeeded, true)
  assert.deepEqual(s.partnerCapabilities, ['유사 실적 5건 이상'])
  assert.equal(s.recommendedRole, '컨소시엄 구성원')
})

test('전부 충족이고 점수가 높으면 주관사다', () => {
  const s = buildStrategy(
    판정({ verdict: 'full', score: 85, hardChecks: [하드({ result: 'met' })] }),
    [], SOFT_WEIGHTS as unknown as Record<string, number>,
  )
  assert.equal(s.recommendedRole, '주관사')
  assert.equal(s.consortiumNeeded, false)
})

test('부적합이면 참여하지 않음이다', () => {
  const s = buildStrategy(판정({ verdict: 'unfit' }), [], SOFT_WEIGHTS as unknown as Record<string, number>)
  assert.equal(s.recommendedRole, '참여하지 않음')
})

test('무거운 이상 조항만 조심할 것에 올린다', () => {
  const anomalies: Anomaly[] = [
    { ruleId: 'R03', title: '법정 공고 기간', grade: 'confirmed', severity: 'blocking', rationale: '20일이다', evidence: [] },
    { ruleId: 'R01', title: '특정 상표', grade: 'confirmed', severity: 'competition', rationale: 'Oracle', evidence: [] },
  ]
  const s = buildStrategy(판정(), anomalies, SOFT_WEIGHTS as unknown as Record<string, number>)
  assert.deepEqual(s.watch.map((w) => w.point), ['법정 공고 기간'])
})

test('위험 항목은 강점·갭에 안 섞인다', () => {
  const s = buildStrategy(
    판정({ parts: { capability: 36, trackRecord: 24, scale: 13, risk: -20, competition: 9 } }),
    [], SOFT_WEIGHTS as unknown as Record<string, number>,
  )
  assert.equal(s.emphasize.some((p) => p.point === '위험 요소'), false)
  assert.equal(s.fill.some((p) => p.point === '위험 요소'), false)
})
