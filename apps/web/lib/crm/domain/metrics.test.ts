// lib/crm/domain/metrics.test.ts — 지표 선언 가드
//
// **이 가드가 막는 것**: 지표를 «선언»이 아니라 «함수»로 되돌리는 일.
// 예전 리포트가 그래서 막혔다 — 파이프라인·예상·소요 셋은 인자가 파이프라인 하나뿐이라
// 「이번 분기 공공 예상」에 답하지 못했다. 지표가 선언이면 축은 무한히 는다.
//
// 그리고 **AI 도우미의 안전선**이기도 하다. 모델이 없는 지표 이름을 만들어 오면
// `isKnownMetric` 이 막는데, 그 함수가 무르면 근거 없는 추정이 확정값이 된다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  METRICS, DERIVED, metricOf, derivedOf, isKnownMetric,
  metricCatalog, canHaveTarget, targetableMetrics,
} from './metrics.ts'
import { DATE_BASIS_LABEL, UNIT_LABEL } from '../../terms/report.ts'

test('지표 키가 겹치지 않는다', () => {
  const keys = [...METRICS.map((m) => m.key), ...DERIVED.map((d) => d.key)]
  assert.equal(new Set(keys).size, keys.length, '같은 키가 두 벌이면 어느 쪽이 도는지 알 수 없다')
})

test('모든 지표에 이름·뜻·단위가 있다 — 화면이 문자열을 만들지 않게', () => {
  for (const m of [...METRICS, ...DERIVED]) {
    assert.ok(m.label && m.label.length > 0, `${m.key} 에 이름이 없다`)
    assert.ok(m.hint && m.hint.length > 0, `${m.key} 에 뜻이 없다`)
    assert.ok(m.unit in UNIT_LABEL, `${m.key} 의 단위 ${m.unit} 를 모른다`)
  }
})

test('기준 날짜가 아는 것이어야 한다 — 없는 날짜를 기준으로 두면 그 지표는 언제나 빈 값이다', () => {
  for (const m of METRICS) {
    assert.ok(m.dateBasis in DATE_BASIS_LABEL, `${m.key} 의 기준 날짜 ${m.dateBasis} 를 모른다`)
  }
})

test('건수를 세는 지표는 금액 칸을 갖지 않는다', () => {
  for (const m of METRICS) {
    if (m.agg === 'count') assert.equal(m.amount, null, `${m.key} 는 건수인데 금액 칸이 있다`)
    if (m.agg === 'sum') assert.notEqual(m.amount, null, `${m.key} 는 합인데 더할 칸이 없다`)
  }
})

test('가중치는 열린 딜에만 걸린다 — 끝난 딜에 확률을 곱하면 뜻이 없다', () => {
  for (const m of METRICS) {
    if (m.weighted) assert.equal(m.scope, 'OPEN', `${m.key} 가 열린 딜이 아닌데 가중치를 쓴다`)
  }
})

test('열린 딜 지표는 마감 예정일이나 단계 진입일로 센다', () => {
  for (const m of METRICS) {
    if (m.scope !== 'OPEN') continue
    assert.ok(
      m.dateBasis === 'expectedCloseDate' || m.dateBasis === 'stageEnteredAt',
      `${m.key} 가 열린 딜인데 ${m.dateBasis} 로 센다 — 열린 딜에는 따낸 날이 없다`,
    )
  }
})

test('성사 딜 지표는 따낸 날이나 사업 기간으로 센다', () => {
  for (const m of METRICS) {
    if (m.scope !== 'WON') continue
    assert.ok(
      m.dateBasis === 'wonAt' || m.dateBasis === 'termSpread',
      `${m.key} 가 성사 딜인데 ${m.dateBasis} 로 센다`,
    )
  }
})

test('파생 지표는 실제로 있는 것에서만 나온다', () => {
  const known = new Set([...METRICS.map((m) => m.key), ...DERIVED.map((d) => d.key), 'target'])
  for (const d of DERIVED) {
    for (const need of d.needs) {
      assert.ok(known.has(need), `${d.key} 가 없는 값 ${need} 를 쓴다`)
    }
    assert.ok(d.needs.length > 0, `${d.key} 에 재료가 없다`)
  }
})

test('금액 넷이 각각 지표로 있다 — 접기 전 값을 물어볼 수 있어야 한다', () => {
  const fields = METRICS.filter((m) => m.amount).map((m) => m.amount)
  for (const f of ['booked', 'budget', 'quoted', 'contract']) {
    assert.ok(fields.includes(f as never), `${f} 를 세는 지표가 없다 — 「견적 나간 총액」을 물어볼 방법이 없어진다`)
  }
})

test('모르는 지표는 막는다 — AI 도우미의 안전선', () => {
  assert.equal(isKnownMetric('open_pipeline'), true)
  assert.equal(isKnownMetric('coverage'), true, '파생도 아는 것이다')
  assert.equal(isKnownMetric('매출액'), false, '없는 이름을 통과시키면 안 된다')
  assert.equal(isKnownMetric(''), false)
  assert.equal(isKnownMetric('OPEN_PIPELINE'), false, '대소문자를 다르게 준 것도 다른 이름이다')
})

test('목록을 찾는 함수가 없는 키에 null 을 준다', () => {
  assert.equal(metricOf('없는키'), null)
  assert.equal(derivedOf('없는키'), null)
  assert.ok(metricOf('bookings'))
  assert.ok(derivedOf('shortfall'))
})

test('적을수록 좋은 것에는 목표를 걸지 않는다', () => {
  assert.equal(canHaveTarget('bookings'), true)
  assert.equal(canHaveTarget('overdue'), false, '기한 지난 딜에 목표를 거는 것은 뜻이 없다')
  assert.equal(canHaveTarget('stalled'), false)
  assert.equal(canHaveTarget('attainment'), false, '파생에 목표를 걸면 같은 것을 두 줄로 적게 된다')
  assert.ok(targetableMetrics().length > 0)
  assert.ok(targetableMetrics().every((m) => canHaveTarget(m.key)))
})

test('목록 함수가 이름과 뜻을 함께 준다 — 도우미가 이걸 읽고 고른다', () => {
  const cat = metricCatalog()
  assert.equal(cat.length, METRICS.length + DERIVED.length)
  assert.ok(cat.every((c) => c.label && c.hint))
  assert.ok(cat.some((c) => c.derived), '파생도 목록에 있어야 도우미가 「부족분」을 안다')
})

/**
 * 선언을 함수로 되돌리는 것을 막는다.
 *
 * 이 파일이 DB 를 알기 시작하면 화면에서 import 할 수 없게 되고,
 * 그러면 도우미와 화면이 **다른 목록**을 보게 된다.
 */
test('지표 선언은 순수하다 — DB 를 모른다', () => {
  const src = readFileSync(new URL('./metrics.ts', import.meta.url), 'utf8')
  for (const banned of ['@prisma/client', 'db/client', 'getCrmDb', 'findMany']) {
    assert.ok(!src.includes(banned), `지표 선언이 ${banned} 를 안다 — 화면에서 못 읽게 된다`)
  }
})
