// 어디서 막히나 — 체류 시간 (dacrm 리포트 v2)
//
// **이 파일이 지키는 것 하나: 표본이 얇을 때 아는 척하지 않는 것.**
//
// 딜 3건으로 "평균 12일"을 내면 사람은 그걸 사실로 읽고 프로세스를 바꾼다.
// 없는 문제를 고치러 가는 것이 문제를 모르는 것보다 나쁘다.
// 그래서 임계 미만이면 숫자를 **아예 만들지 않는다**.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildStageDurations, bottleneckOf, velocitySummary, MIN_SAMPLE,
  type HistoryRow,
} from './velocity.ts'

const STAGES = [
  { id: 's1', name: '리드', position: 1, kind: 'OPEN' },
  { id: 's2', name: '제안', position: 2, kind: 'OPEN' },
  { id: 'won', name: '수주', position: 3, kind: 'WON' },
  { id: 'lost', name: '실주', position: 4, kind: 'LOST' },
]

const DAY = 86400

function hist(stageId: string, days: number[]): HistoryRow[] {
  return days.map((d) => ({ stageId, durationSec: d * DAY }))
}

test('★ 표본이 임계 미만이면 숫자를 내지 않는다 — 우연을 경향이라 부르면 안 된다', () => {
  const rows = buildStageDurations(STAGES, hist('s1', [1, 2, 3, 4]), new Map())
  const lead = rows.find((r) => r.stageId === 's1')!
  assert.equal(lead.insufficient, true)
  assert.equal(lead.medianDays, null)
  assert.equal(lead.maxDays, null)
  assert.equal(lead.samples, 4, '표본 수 자체는 숨기지 않는다')
})

test('★ 임계에 닿으면 숫자를 낸다 — 과하게 막으면 기능이 없는 것과 같다', () => {
  const rows = buildStageDurations(STAGES, hist('s1', [2, 4, 6, 8, 10]), new Map())
  const lead = rows.find((r) => r.stageId === 's1')!
  assert.equal(lead.insufficient, false)
  assert.equal(lead.medianDays, 6)
  assert.equal(lead.samples, MIN_SAMPLE)
})

test('★ 평균이 아니라 중앙값이다 — 몇 년 끌던 딜 하나가 평균을 통째로 옮긴다', () => {
  // 평균이면 (1+1+1+1+1000)/5 = 200.8 일. 실제 감각은 1일이다.
  const rows = buildStageDurations(STAGES, hist('s1', [1, 1, 1, 1, 1000]), new Map())
  const lead = rows.find((r) => r.stageId === 's1')!
  assert.equal(lead.medianDays, 1)
  assert.equal(lead.maxDays, 1000, '이상값 자체는 숨기지 않는다')
})

test('짝수 표본은 가운데 둘의 평균 — 6건이면 3·4번째', () => {
  const rows = buildStageDurations(STAGES, hist('s1', [2, 4, 6, 8, 10, 12]), new Map())
  assert.equal(rows.find((r) => r.stageId === 's1')!.medianDays, 7)
})

test('하루 미만도 접지 않는다 — 0.5일을 0일로 만들면 "즉시 넘어감"이 사라진다', () => {
  const rows = buildStageDurations(STAGES, [
    ...Array.from({ length: 5 }, () => ({ stageId: 's1', durationSec: DAY / 2 })),
  ], new Map())
  assert.equal(rows.find((r) => r.stageId === 's1')!.medianDays, 0.5)
})

test('★ 음수 기간은 버린다 — 0 으로 접으면 "즉시 넘어갔다"는 거짓이 생긴다', () => {
  const rows = buildStageDurations(STAGES, [
    { stageId: 's1', durationSec: -100 },
    ...hist('s1', [2, 4, 6, 8, 10]),
  ], new Map())
  const lead = rows.find((r) => r.stageId === 's1')!
  assert.equal(lead.samples, 5, '음수가 표본에 섞였다')
  assert.equal(lead.medianDays, 6)
})

test('기간이 없는 이력(첫 이동)은 세지 않는다', () => {
  const rows = buildStageDurations(STAGES, [
    { stageId: 's1', durationSec: null },
    ...hist('s1', [2, 4, 6, 8, 10]),
  ], new Map())
  assert.equal(rows.find((r) => r.stageId === 's1')!.samples, 5)
})

test('성사·실패는 머무는 단계가 아니다 — 체류 시간을 물을 자리가 아니다', () => {
  const rows = buildStageDurations(STAGES, hist('won', [1, 2, 3, 4, 5]), new Map())
  assert.deepEqual(rows.map((r) => r.stageId), ['s1', 's2'])
})

test('지금 서 있는 딜 수는 기간과 별개로 보여 준다 — 표본이 없어도 알 수 있다', () => {
  const rows = buildStageDurations(STAGES, [], new Map([['s2', 3]]))
  const s2 = rows.find((r) => r.stageId === 's2')!
  assert.equal(s2.standing, 3)
  assert.equal(s2.insufficient, true)
})

test('★ 비교 대상이 하나뿐이면 병목이라 말하지 않는다 — 비교 없이 "여기가 문제"는 추측이다', () => {
  const rows = buildStageDurations(STAGES, hist('s1', [2, 4, 6, 8, 10]), new Map())
  assert.equal(bottleneckOf(rows), null)
  assert.ok(velocitySummary(rows).includes('두 곳 이상'))
})

test('두 곳 이상 쌓이면 더 오래 머무는 쪽을 짚는다', () => {
  const rows = buildStageDurations(STAGES, [
    ...hist('s1', [1, 1, 1, 1, 1]),
    ...hist('s2', [20, 20, 20, 20, 20]),
  ], new Map())
  const worst = bottleneckOf(rows)
  assert.equal(worst?.stageName, '제안')
  assert.ok(velocitySummary(rows).includes('제안'))
})

test('아무것도 없으면 모른다고 말한다 — 빈 화면에 0일이라 쓰면 거짓이다', () => {
  const rows = buildStageDurations(STAGES, [], new Map())
  const s = velocitySummary(rows)
  assert.ok(s.includes('아직 판단할 만큼'))
  assert.ok(!s.includes('0일'))
})

test('★ 리포트가 실제로 체류 시간을 부른다 — 안 부르면 또 쌓기만 하는 데이터가 된다', () => {
  const api = readFileSync(new URL('../../../app/api/crm/reports/route.ts', import.meta.url), 'utf8')
  assert.ok(api.includes('buildVelocity('), 'API 가 체류 시간을 만들지 않는다')
  const ui = readFileSync(new URL('../../../app/(crm)/crm/reports/ReportsClient.tsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('body.velocity'), '화면이 응답의 체류 시간을 읽지 않는다')
  assert.ok(ui.includes('어디서 오래 머무나'), '화면이 그리지 않는다')
  assert.ok(ui.includes('아직 모름'), '표본이 얇을 때 화면이 모른다고 말하지 않는다')
})

test('★ 떠난 단계 기준으로 묶는다 — 반대로 묶으면 모든 숫자가 한 칸씩 밀린다', () => {
  const src = readFileSync(new URL('./velocity.ts', import.meta.url), 'utf8')
  assert.ok(src.includes('h.fromStageId'), '이력의 fromStageId 를 쓰지 않는다')
  assert.ok(src.includes('stageId: h.fromStageId'), '떠난 단계를 stageId 로 넘기지 않는다')
})
