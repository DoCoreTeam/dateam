/**
 * 기간 리포트 — **표본이 없으면 「없다」고 말한다**
 *
 * 「평균 지연 0.0초」와 「잰 것이 없음」이 화면에서 같아 보이면 사람은 앞의 것으로 읽고,
 * 「우리 시스템은 빠르다」는 결론이 표본 0건에서 나온다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computeReport, isReportRejection, reportLines, buildReportPrompt, type ReportInput,
} from './report-core.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const FULL: ReportInput = {
  from: '2026-09-01', to: '2026-09-25',
  signalsTotal: 20, followed: 12, late: 3, skipped: 4, expired: 1,
  medianServerSec: 3.2, medianToOpenSec: 45, medianToOrderSec: 70, medianToFillSec: 2.1,
  daysWithFail: 2, daysChecked: 18,
  actionsApplied: 5, actionsHandedOff: 3,
}

const EMPTY: ReportInput = {
  from: '2026-09-01', to: '2026-09-25',
  signalsTotal: 0, followed: 0, late: 0, skipped: 0, expired: 0,
  medianServerSec: null, medianToOpenSec: null, medianToOrderSec: null, medianToFillSec: null,
  daysWithFail: 0, daysChecked: 0,
  actionsApplied: 0, actionsHandedOff: 0,
}

test('비율을 센다 — 늦게 따른 것도 따른 것이다', () => {
  const m = computeReport(FULL)
  assert.ok(!isReportRejection(m))
  assert.equal(m.followRate, 0.75)
  assert.equal(m.failDayRate, 2 / 18)
  assert.equal(m.measuredSegments, 4)
})

test('★ 표본이 0 이면 비율이 0% 가 아니라 null — 0 으로 안 나눈다', () => {
  const m = computeReport(EMPTY)
  assert.ok(!isReportRejection(m))
  assert.equal(m.followRate, null, '신호 0건인데 따른 비율이 숫자로 나왔다')
  assert.equal(m.failDayRate, null, '본 날 0일인데 빨간 비율이 숫자로 나왔다')
  assert.equal(m.measuredSegments, 0)
})

test('★ 「잰 것 없음」이 화면에서 0% 와 다르게 보인다', () => {
  const lines = reportLines(computeReport(EMPTY) as never)
  assert.ok(lines.some((l) => l === '따른 비율: 잰 것 없음'))
  assert.ok(lines.some((l) => l === '지연: 잰 구간이 없습니다'))
  assert.ok(lines.some((l) => l === '점검: 본 날이 없습니다'))
  assert.equal(lines.some((l) => l.includes('0%')), false, '표본 0 을 0% 로 적었다')
  assert.equal(lines.some((l) => l.includes('0.0초')), false, '못 잰 것을 0.0초로 적었다')
})

test('★ 구간 하나만 못 재도 그 구간만 「못 잼」이다', () => {
  const m = computeReport({ ...FULL, medianToOpenSec: null })
  assert.ok(!isReportRejection(m))
  assert.equal(m.measuredSegments, 3)
  const lines = reportLines(m)
  const delay = lines.find((l) => l.startsWith('지연 중앙값'))
  assert.ok(delay)
  assert.ok(delay.includes('사람 보기 못 잼'))
  assert.ok(delay.includes('서버 3.2초'))
})

test('기간이 거꾸로면 만들지 않는다', () => {
  const r = computeReport({ ...FULL, from: '2026-09-25', to: '2026-09-01' })
  assert.ok(isReportRejection(r))
  assert.equal(r.reason, 'period_reversed')
})

test('★ 신호 결과 넷이 전부 줄에 있다 — 빠지면 어디로 샜는지 모른다', () => {
  const lines = reportLines(computeReport(FULL) as never)
  const signal = lines.find((l) => l.startsWith('신호 '))
  assert.ok(signal)
  for (const word of ['따름 12', '늦게 따름 3', '건너뜀 4', '만료 1']) {
    assert.ok(signal.includes(word), `${word} 가 없다`)
  }
})

test('프롬프트가 「없음」을 0 으로 바꾸지 말라고 말한다', () => {
  const p = buildReportPrompt(reportLines(computeReport(EMPTY) as never))
  assert.ok(p.includes('있는 숫자만'))
  assert.ok(p.includes('0 으로 바꿔 말하지 않는다'))
  assert.ok(p.includes('예측하지 않고'))
})

// ── 셈과 저장 ────────────────────────────────────────────

test('★ 셈이 AI 를 안 부른다', () => {
  const src = readFileSync(join(HERE, 'report-core.ts'), 'utf8')
  assert.equal(/callKnowledge|callGemini|fetch\(|createAdminClient/.test(src), false)
})

test('★ AI 응답이 숫자 칸으로 안 간다', () => {
  const src = readFileSync(join(HERE, 'report.ts'), 'utf8')
  const insertAt = src.indexOf('.insert({')
  const body = src.slice(insertAt, src.indexOf('.select', insertAt))
  assert.ok(body.includes('metrics,'))
  assert.equal(/period_\w+:\s*call|metrics:\s*call/.test(body), false)
})

test('★ 쓰는 표가 하나뿐이고 설정을 안 바꾼다', () => {
  const src = readFileSync(join(HERE, 'report.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  const tables = [...src.matchAll(/\.from\('(\w+)'\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(tables)], ['trading_reports'])
  assert.equal(/saveTradingSetting|trading_settings/.test(src), false)
})

test('★ 같은 기간을 두 번 안 만든다 — DB 가 막는다', () => {
  const sql = readFileSync(
    join(HERE, '..', '..', '..', '..', '..', 'supabase', 'migrations', '286_trading_operator.sql'), 'utf8')
  assert.ok(sql.includes('UNIQUE (period_from, period_to)'))
  const src = readFileSync(join(HERE, 'report.ts'), 'utf8')
  assert.ok(src.includes("reason: 'already_made'"))
})

test('★ AI 가 죽어도 숫자는 남는다', () => {
  const src = readFileSync(join(HERE, 'report.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function makeReport'))
  const afterCall = fn.slice(fn.indexOf('const call = await callKnowledge'))
  const beforeInsert = afterCall.slice(0, afterCall.indexOf('.insert({'))
  assert.equal(/if \(!call\.ok\) return/.test(beforeInsert), false)
})
