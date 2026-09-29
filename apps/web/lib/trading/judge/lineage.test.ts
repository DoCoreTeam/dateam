/**
 * 판단 계보 — **물음을 저장하지 않고 되살린다**
 *
 * 되살린 물음이 그때 보낸 것과 다르면 이 칸은 기록이 아니라 지어낸 것이 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLineage, type LineageInput } from './lineage.ts'
import { buildJevPrompt } from './jev-prompt.ts'
import { computeIndicators, evaluateTriggers } from './indicators.ts'
import type { MinuteBarInput } from '../bars/confirm.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const START = new Date('2026-09-29T00:00:00.000Z')

/** 조건이 걸리도록 오르내리는 봉 */
function bars(count: number): MinuteBarInput[] {
  return Array.from({ length: count }, (_, i) => {
    const p = 400 + Math.sin(i / 5) * 4 + (i > 30 ? (i - 30) * 0.3 : 0)
    return { startAt: new Date(START.getTime() + i * 60_000), open: p, high: p + 0.8, low: p - 0.8, close: p + 0.2, volume: 10 }
  })
}

const PARAMS = { atrPeriod: 14, smaFastPeriod: 5, smaSlowPeriod: 20, breakoutPeriod: 20, breakoutAtrMultiple: 0.1 }
const ALL = bars(60)
/** 35번 봉에서 난 판단 — 이 자리에서 breakout_up 이 실제로 걸린다(실측) */
const AT = new Date(START.getTime() + 36 * 60_000).toISOString()

const BASE: LineageInput = {
  bars: ALL,
  jev: {
    id: 'j1', barCloseAt: AT, status: 'completed',
    rawScore: { p_long: 0.6, p_short: 0.1, p_hold: 0.3, enter_now: 0.6 },
    abstainReason: null, modelVersion: 'google/gemini-2.5-flash', promptVersion: 'jev-prompt-v1',
    requestAt: '2026-09-29T00:36:05.000Z', responseAt: '2026-09-29T00:36:13.500Z',
  },
  rule: { rawScore: { p_long: 0.55, p_short: 0.2, p_hold: 0.25 } },
  params: PARAMS,
  sessionOpenAt: START.toISOString(),
  configuredModel: 'google/gemini-2.5-flash',
  reasoningEffort: 'low',
  timeoutMs: 20_000,
  blocked: { step: 1, total: 6, reason: 'safety_gate:SG-02' },
  shown: { direction: '롱', prob: 0.6, plan: '진입 401.2 · 손절 399.1 · 목표 403.8' },
}

test('★ 여덟 걸음이 서고 AI 는 한 줄뿐이다', () => {
  const l = buildLineage(BASE)
  assert.equal(l.unavailable, null, `계보를 못 세웠다: ${l.unavailable}`)
  assert.ok(l.steps.length >= 8, `걸음이 ${l.steps.length}개뿐이다`)
  const ai = l.steps.filter((s) => s.actor === 'ai')
  assert.equal(ai.length, 1, 'AI 줄이 하나가 아니다 — 코드와 AI 를 못 가른다')
  assert.equal(ai[0].name, 'Jev')
  // 줄 번호가 이어진다
  assert.deepEqual(l.steps.map((s) => s.no), l.steps.map((_, i) => i + 1))
})

/**
 * **되살린 물음이 그때 보낸 것과 같아야 한다.**
 * 다르면 이 칸은 기록이 아니라 지어낸 것이다.
 */
test('★ 되살린 물음이 실제로 보내는 문장과 글자까지 같다', () => {
  const l = buildLineage(BASE)
  const askStep = l.steps.find((s) => s.name === '물음 조립')
  assert.ok(askStep?.detail, '물음을 안 되살린다')

  // 같은 재료로 실제 조립기를 직접 부른다
  const seen = ALL.slice(0, 36)
  const ind = computeIndicators(seen, PARAMS)
  assert.ok(ind)
  const trig = evaluateTriggers(seen, ind, PARAMS)
  assert.ok(trig, '이 봉 묶음에서 조건이 안 걸렸다 — 시험이 아무것도 안 잰다')
  const real = buildJevPrompt({
    asOf: new Date(Date.parse(AT)), contractCode: '', decisionTf: '1m',
    bars: seen, trigger: trig, minutesSinceOpen: 35, indicators: ind,
  }).text
  assert.equal(askStep.detail, real, '되살린 물음이 실제로 보내는 문장과 다르다')
})

test('★ 뒤 봉을 안 섞는다 — 봉이 더 들어와도 같은 물음이 나온다', () => {
  const later = buildLineage({ ...BASE, bars: bars(90) })
  const now = buildLineage(BASE)
  const a = now.steps.find((s) => s.name === '물음 조립')?.detail
  const b = later.steps.find((s) => s.name === '물음 조립')?.detail
  assert.ok(a && b)
  assert.equal(b, a, '봉이 더 들어오자 물음이 바뀐다 — 그때 세울 수 없던 물음이다')
})

test('★ 답이 안 온 판도 같은 자리에 그린다', () => {
  const l = buildLineage({
    ...BASE,
    jev: { ...BASE.jev!, status: 'failed', rawScore: null, abstainReason: 'call_failed:jev_http_403' },
  })
  const ai = l.steps.find((s) => s.actor === 'ai')
  assert.ok(ai, 'AI 줄이 사라졌다 — 실패하면 화면이 조용해진다')
  assert.equal(ai.tone, 'blocked')
  assert.match(ai.produced, /403/, '왜 안 왔는지를 안 말한다')
  // 앞 걸음들은 그대로 있어야 한다. 어디까지 갔는지가 보여야 고칠 곳을 안다
  assert.ok(l.steps.some((s) => s.name === '물음 조립' && s.detail))
})

test('★ 조건이 안 걸린 판은 「안 부른 것」이라고 말한다', () => {
  // 평평한 봉이면 조건이 안 걸린다
  const flat = Array.from({ length: 60 }, (_, i) => ({
    startAt: new Date(START.getTime() + i * 60_000), open: 400, high: 400.1, low: 399.9, close: 400, volume: 1,
  }))
  const l = buildLineage({ ...BASE, bars: flat })
  const trig = l.steps.find((s) => s.name === '진입 조건')
  assert.ok(trig)
  assert.match(trig.produced, /안 걸렸/, '조건이 안 걸린 것을 안 말한다')
  assert.equal(trig.tone, 'waiting', '안 부른 것을 고장으로 그린다')
})

test('★ 계보를 못 세우면 빈 칸이 아니라 사유를 낸다', () => {
  assert.match(buildLineage({ ...BASE, jev: null }).unavailable ?? '', /판단이 없습니다/)
  assert.match(buildLineage({ ...BASE, jev: { ...BASE.jev!, barCloseAt: '언제인지 모름' } }).unavailable ?? '', /시각/)
  assert.match(buildLineage({ ...BASE, bars: [] }).unavailable ?? '', /못 찾았습니다/)
})

test('★ 기록에 모델이 비었으면 설정값으로 메우되 지어내지 않는다', () => {
  const l = buildLineage({ ...BASE, jev: { ...BASE.jev!, modelVersion: '', promptVersion: '' } })
  assert.equal(l.model, 'google/gemini-2.5-flash', '설정에 있는 모델을 안 쓴다')
  assert.match(l.promptVersion, /jev-prompt/)
})

test('★ 화면 칸이 계보를 실제로 그린다', () => {
  const panel = readFileSync(join(HERE, '..', '..', '..', 'app', '(trading)', 'trading', 'LineagePanel.tsx'), 'utf8')
  assert.match(panel, /lineage\.steps\.map/, '걸음을 안 그린다')
  // AI 줄이 눈에 띄게 갈려야 코드 문제와 AI 문제를 가른다
  assert.match(panel, /actor === 'ai'/, 'AI 줄을 안 가른다')
  assert.match(panel, /referenced/, '무엇을 참조했는지를 안 그린다')
  assert.match(panel, /produced/, '무엇을 냈는지를 안 그린다')
})
