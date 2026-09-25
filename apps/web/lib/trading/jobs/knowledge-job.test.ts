/**
 * 지식 작업 — **맨 뒤이고, 한 분에 하나다** (§10.2)
 *
 * 먼저 돌면 AI 가 느린 날 그 분의 수집과 판단이 통째로 밀린다. 밀린 봉은 다시 안 온다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  KNOWLEDGE_TASKS, TASK_LABEL, pickKnowledgeTask, knowledgeReason, type KnowledgeContext,
} from './knowledge-plan.ts'
import { WATCH_ORDER } from './watch-plan.ts'
import { RUN_BUDGET_MS } from './tick-core.ts'
import { knowledgeProgressOf } from '../overview-shape.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const IDLE: KnowledgeContext = {
  pendingSources: 0, unexplainedSignals: 0, holdingPosition: false,
  reportMadeToday: true, hasOpenProposal: true, settingsWithoutHelp: 0, uncardedSources: 0,
  elapsedMs: 0, budgetMs: RUN_BUDGET_MS, perTaskMs: 12_000, continuousTrading: false,
}

test('할 일이 없으면 아무것도 안 한다', () => {
  assert.deepEqual(pickKnowledgeTask(IDLE), { task: null, reason: 'nothing_to_do' })
})

test('★ 시간이 모자라면 시작도 안 한다 — 시작하면 다음 분 실행과 겹친다', () => {
  assert.deepEqual(
    pickKnowledgeTask({ ...IDLE, pendingSources: 5, elapsedMs: RUN_BUDGET_MS - 1000 }),
    { task: null, reason: 'no_time' })
})

test('★ 한 분에 하나만 고른다', () => {
  const busy: KnowledgeContext = {
    ...IDLE, pendingSources: 9, unexplainedSignals: 9, holdingPosition: true,
    reportMadeToday: false, hasOpenProposal: false, settingsWithoutHelp: 9, uncardedSources: 9,
  }
  const pick = pickKnowledgeTask(busy)
  assert.ok(pick.task)
  assert.ok(KNOWLEDGE_TASKS.includes(pick.task))
})

test('★ 장중에는 급한 둘만 한다 — 나머지는 지금 안 해도 된다', () => {
  const during: KnowledgeContext = {
    ...IDLE, continuousTrading: true,
    pendingSources: 9, reportMadeToday: false, settingsWithoutHelp: 9, uncardedSources: 9,
  }
  // 자료 분석·리포트·도우미가 다 밀려 있어도 장중엔 안 한다
  assert.deepEqual(pickKnowledgeTask(during), { task: null, reason: 'nothing_to_do' })
  assert.equal(pickKnowledgeTask({ ...during, holdingPosition: true }).task, 'exit_shadow')
  assert.equal(pickKnowledgeTask({ ...during, unexplainedSignals: 1 }).task, 'explain_signal')
})

test('★ 청산 섀도가 신호 설명보다 먼저다 — 들고 있는 것이 먼저다', () => {
  const both: KnowledgeContext = { ...IDLE, holdingPosition: true, unexplainedSignals: 3 }
  assert.equal(pickKnowledgeTask(both).task, 'exit_shadow')
})

test('장 밖에서는 자료 분석부터', () => {
  assert.equal(pickKnowledgeTask({ ...IDLE, pendingSources: 1 }).task, 'analyze_source')
})

test('★ 대기 중인 후보가 있으면 새 후보를 안 낸다 — 쌓이면 사람이 안 고른다', () => {
  const ready: KnowledgeContext = { ...IDLE, reportMadeToday: true, hasOpenProposal: false }
  assert.equal(pickKnowledgeTask(ready).task, 'spec_candidate')
  assert.notEqual(pickKnowledgeTask({ ...ready, hasOpenProposal: true }).task, 'spec_candidate')
})

test('★ 리포트가 없으면 후보도 안 낸다 — 근거 없이 설정을 바꾸자고 하지 않는다', () => {
  const noReport: KnowledgeContext = { ...IDLE, reportMadeToday: false, hasOpenProposal: false }
  assert.equal(pickKnowledgeTask(noReport).task, 'pattern_report')
})

test('모든 작업에 이름이 있다 — 이름 없는 작업은 화면에서 사라진다', () => {
  for (const t of KNOWLEDGE_TASKS) assert.ok(TASK_LABEL[t]?.length > 0, `${t} 에 이름이 없다`)
  assert.equal(new Set(Object.values(TASK_LABEL)).size, KNOWLEDGE_TASKS.length)
})

test('사유가 무엇을 했는지 말한다', () => {
  assert.equal(knowledgeReason({ task: 'analyze_source' }, 'done:kept=2'), 'knowledge=analyze_source:done:kept=2')
  assert.equal(knowledgeReason({ task: null, reason: 'no_time' }), 'knowledge=no_time')
})

test('★ 화면이 사유를 사람 말로 옮긴다 — 「안 일어난다」와 구별돼야 한다', () => {
  const p = knowledgeProgressOf('judged|watch=none|emit:calibrate:x|knowledge=analyze_source:done')
  assert.ok(p)
  assert.equal(p.task, 'analyze_source')
  assert.equal(p.label, '자료 분석')
  assert.equal(p.outcome, 'done')
  assert.equal(knowledgeProgressOf('judged|knowledge=no_time'), null)
  assert.equal(knowledgeProgressOf(null), null)
})

// ── 순서와 배선 ──────────────────────────────────────────

test('★ 지식이 §10.2 우선순위의 어디에도 안 낀다 — 감시 목록과 겹치지 않는다', () => {
  const watch = new Set<string>([...WATCH_ORDER])
  for (const t of KNOWLEDGE_TASKS) {
    assert.equal(watch.has(t), false, `${t} 가 감시 목록에 있다 — 지식은 감시가 아니다`)
  }
})

test('★ 지식이 tick 에서 맨 뒤에 불린다', () => {
  const tick = readFileSync(join(HERE, 'tick.ts'), 'utf8')
  const watchAt = tick.search(/const watch = await runWatch\(/)
  const emitAt = tick.search(/const emitNote = await emitOrExplain\(/)
  const knowAt = tick.search(/const knowledgeNote = await knowledgeOrExplain\(/)
  assert.ok(watchAt > 0 && emitAt > 0 && knowAt > 0, '셋 중 하나가 안 불린다')
  assert.ok(watchAt < knowAt, '지식이 감시보다 먼저 돈다')
  assert.ok(emitAt < knowAt, '지식이 신호 발행보다 먼저 돈다')
})

test('★ 지식이 실패해도 수집·판단·신호가 산다', () => {
  const tick = readFileSync(join(HERE, 'tick.ts'), 'utf8')
  const fn = tick.slice(tick.indexOf('async function knowledgeOrExplain'))
  assert.ok(fn.includes('try {') && fn.includes('} catch'), '감싸져 있지 않다')
  assert.ok(fn.includes('knowledge_failed:'), '실패 사유를 안 남긴다')

  const job = readFileSync(join(HERE, 'knowledge-job.ts'), 'utf8')
  const run = job.slice(job.indexOf('export async function runKnowledgeJob'))
  const body = run.slice(0, run.indexOf('\n}'))
  assert.ok(body.includes('} catch'), '작업기가 던진다')
})

test('★ 지식 작업이 신호·알림을 안 만든다', () => {
  const job = readFileSync(join(HERE, 'knowledge-job.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  for (const banned of ['queueNotification', 'saveSignal', 'decideEmit', 'emitSignal', 'trading_notifications']) {
    assert.equal(job.includes(banned), false, `지식 작업이 ${banned} 에 닿는다`)
  }
})

test('★ 지식 작업이 설정을 직접 안 바꾼다 — 후보를 올릴 뿐이다', () => {
  const job = readFileSync(join(HERE, 'knowledge-job.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  assert.equal(/saveTradingSetting|decideProposal/.test(job), false,
    '지식 작업이 설정을 바꾸거나 제 제안을 스스로 받아들인다')
})
