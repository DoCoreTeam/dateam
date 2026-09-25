import 'server-only'

/**
 * 지식 작업 — 매분 **하나만**, 맨 뒤에 (§10.2)
 *
 * 무엇을 할지는 `knowledge-plan.ts` 의 순수 함수가 고른다. 여기는 그 하나를 실제로 한다.
 *
 * **이 모듈이 실패해도 수집·판단·신호는 그대로다.** 부르는 쪽(`tick.ts`)이 감싸고,
 * 여기서도 던지지 않고 사유를 값으로 돌려준다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { RUN_BUDGET_MS } from './tick-core.ts'
import { pickKnowledgeTask, knowledgeReason, type KnowledgeContext } from './knowledge-plan.ts'
import { analyzeSource } from '../knowledge/sources.ts'
import { explainSignal, signalsNeedingExplanation } from '../knowledge/explain.ts'
import { makeReport } from '../knowledge/pattern.ts'
import { proposeFromReport, proposalsAsOf } from '../knowledge/proposal.ts'
import { reportsAsOf } from '../knowledge/pattern.ts'
import { makeSettingHelp, helpTopic } from '../knowledge/setting-help-run.ts'
import { cardsAsOf, makeCard } from '../knowledge/cards.ts'
import { sourcesAsOf } from '../knowledge/sources.ts'
import { metricsToLines } from '../knowledge/pattern-core.ts'
import { TRADING_SETTINGS } from '../settings/registry.ts'
import { judgeExitShadow } from '../judge/exit-jev.ts'
import { buildExitContext, exitCloses, leansExit } from '../judge/exit-core.ts'
import { asOfContext, futureCount } from '../knowledge/as-of.ts'
import type { JudgeInput } from '../judge/types.ts'

export interface KnowledgeJobInput {
  now: Date
  startedAt: Date
  tradeDate: string
  continuousTrading: boolean
  model: string | null
  /** 지금 들고 있는 포지션. 없으면 null */
  position: {
    contractCode: string
    direction: 'long' | 'short'
    entryPrice: number
    currentPrice: number
    stopPrice: number
    targetPrice: number
    minutesHeld: number
    minutesToSessionExit: number
    barCloseAt: Date
    specVersion: string
    jevTimeoutMs: number
    jevModel: string
    judgeInput: JudgeInput
  } | null
  /** 패턴 리포트가 볼 구간 */
  reportFrom: string
  reportMinSamples: number
  reportMinBucketSamples: number
}

export interface KnowledgeJobResult {
  reason: string
  /** 이번에 무엇을 했나. 아무것도 안 했으면 null */
  task: string | null
}

/** 지식 작업 하나에 이만큼 걸린다고 본다 */
const PER_TASK_MS = 12_000

export async function runKnowledgeJob(input: KnowledgeJobInput): Promise<KnowledgeJobResult> {
  const ctx = await buildContext(input)
  const pick = pickKnowledgeTask(ctx)
  if (pick.task === null) return { reason: knowledgeReason(pick), task: null }

  try {
    const outcome = await doTask(pick.task, input)
    return { reason: knowledgeReason(pick, outcome), task: pick.task }
  } catch (error) {
    // 던지지 않는다. 지식이 죽어도 수집과 판단은 돈다
    const detail = error instanceof Error ? error.message : 'unknown'
    return { reason: knowledgeReason(pick, `threw:${detail}`.slice(0, 120)), task: pick.task }
  }
}

async function buildContext(input: KnowledgeJobInput): Promise<KnowledgeContext> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  const { count: pending, error: pendingError } = await admin
    .from('trading_source_analyses')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'done')
  if (pendingError) throw new Error(`자료 대기 수를 세지 못했습니다: ${pendingError.message}`)

  const unexplained = await signalsNeedingExplanation(5)
  const reports = await reportsAsOf(input.now, 5)
  const proposals = await proposalsAsOf(input.now, 30)
  const helpCards = await cardsAsOf(input.now, 200)

  const haveHelp = new Set(helpCards.map((c) => c.topic))
  const settingsWithoutHelp = TRADING_SETTINGS.filter((s) => !haveHelp.has(helpTopic(s.key))).length

  // 분석이 끝났는데 아직 카드가 안 된 자료
  const analyzed = (await sourcesAsOf(input.now, 50)).filter((s) => s.status === 'done')
  const haveTopics = new Set(helpCards.map((c) => c.topic))
  const uncardedSources = analyzed.filter((s) => !haveTopics.has(sourceTopic(s.id))).length

  return {
    pendingSources: pending ?? 0,
    unexplainedSignals: unexplained.length,
    holdingPosition: input.position !== null,
    reportMadeToday: reports.some((r) => r.windowTo === input.tradeDate),
    hasOpenProposal: proposals.some((p) => p.status === 'proposed'),
    settingsWithoutHelp,
    uncardedSources,
    elapsedMs: input.now.getTime() - input.startedAt.getTime(),
    budgetMs: RUN_BUDGET_MS,
    perTaskMs: PER_TASK_MS,
    continuousTrading: input.continuousTrading,
  }
}

async function doTask(task: string, input: KnowledgeJobInput): Promise<string> {
  if (task === 'analyze_source') return analyzeOne(input)
  if (task === 'explain_signal') return explainOne(input)
  if (task === 'exit_shadow') return exitShadow(input)
  if (task === 'pattern_report') return reportOne(input)
  if (task === 'knowledge_card') return cardOne(input)
  if (task === 'spec_candidate') return proposeOne(input)
  if (task === 'setting_help') return helpOne(input)
  return 'unknown_task'
}

async function analyzeOne(input: KnowledgeJobInput): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_source_analyses')
    .select('id')
    .neq('status', 'done')
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw new Error(`자료를 고르지 못했습니다: ${error.message}`)
  const id = (data ?? [])[0]?.id as string | undefined
  if (!id) return 'none'
  const r = await analyzeSource(id, input.model)
  return r.analyzed ? `done:kept=${r.kept},dropped=${r.dropped}` : r.reason
}

async function explainOne(input: KnowledgeJobInput): Promise<string> {
  const [next] = await signalsNeedingExplanation(1)
  if (!next) return 'none'
  const r = await explainSignal(next.id, next.facts, 'explain-v1', input.model)
  return r.explained ? 'done' : r.reason
}

/**
 * 청산 판단 섀도. **기록만 한다** — `leansExit` 로 기울기를 읽어 사유에만 적고,
 * 알림이나 신호로는 아무것도 안 만든다(§7.3 D-11).
 */
async function exitShadow(input: KnowledgeJobInput): Promise<string> {
  const p = input.position
  if (!p) return 'no_position'
  const ctx = buildExitContext({
    direction: p.direction,
    entryPrice: p.entryPrice,
    currentPrice: p.currentPrice,
    stopPrice: p.stopPrice,
    targetPrice: p.targetPrice,
    atr: p.judgeInput.indicators.atr,
    minutesHeld: p.minutesHeld,
    minutesToSessionExit: p.minutesToSessionExit,
  })
  if (!ctx) return 'atr_zero'

  const r = await judgeExitShadow({
    contractCode: p.contractCode,
    barCloseAt: p.barCloseAt,
    specVersion: p.specVersion,
    ctx,
    closes: exitCloses(p.judgeInput, 20),
    timeoutMs: p.jevTimeoutMs,
    model: p.jevModel,
    now: input.now,
  })
  if (r.status !== 'completed') return `${r.status}:${r.reason}`
  // 기울기는 기록에만 남는다. 섀도라 여기서 끝이다
  return `shadow:${leansExit(r.score) ? 'leans_exit' : 'leans_hold'}`
}

/** 자료 하나를 카드 주제로 묶는 이름. 같은 자료에 카드가 두 장 안 쌓인다 */
export function sourceTopic(sourceId: string): string {
  return `source:${sourceId}`
}

/**
 * 분석 끝난 자료를 지식 카드로 옮긴다.
 *
 * 근거는 **그 자료의 인용**이다 — 이미 원문과 대조해 남긴 것만 있으므로
 * 카드의 근거 강제가 실제 인용으로 채워진다.
 */
async function cardOne(input: KnowledgeJobInput): Promise<string> {
  const cards = await cardsAsOf(input.now, 200)
  const have = new Set(cards.map((c) => c.topic))
  const next = (await sourcesAsOf(input.now, 50))
    .filter((s) => s.status === 'done' && s.findings.length > 0)
    .find((s) => !have.has(sourceTopic(s.id)))
  if (!next) return 'none'

  const r = await makeCard({
    topic: sourceTopic(next.id),
    facts: next.findings.map((f) => `${f.claim} (원문: ${f.quote})`),
    model: input.model,
    promptVersion: 'card-from-source-v1',
  })
  return r.made ? `done:${next.id}` : r.reason
}

async function reportOne(input: KnowledgeJobInput): Promise<string> {
  const r = await makeReport({
    from: input.reportFrom,
    to: input.tradeDate,
    minSamples: input.reportMinSamples,
    minBucketSamples: input.reportMinBucketSamples,
    model: input.model,
  })
  return r.made ? `done:${r.sampleCount}` : r.reason
}

/**
 * 스펙 후보. **이미 있는 리포트의 숫자만** 넘긴다 — 원자료를 넘기면 AI 가 다시 센다.
 *
 * 그리고 지금 시점에 볼 수 있는 리포트만 본다(as-of). 미래에 쓴 리포트로 오늘 설정을
 * 바꾸자고 하면 그 제안은 그때 알 수 없던 것에 근거한 것이다.
 */
async function proposeOne(input: KnowledgeJobInput): Promise<string> {
  const reports = await reportsAsOf(input.now, 5)
  const visible = asOfContext(reports, input.now, 1)
  const latest = visible.used[0]
  if (!latest) return 'no_report'
  const hidden = futureCount(reports, input.now)

  const r = await proposeFromReport({
    tradeDate: input.tradeDate,
    reportLines: metricsToLines(latest.metrics),
    model: input.model,
  })
  const rejected = r.rejected.length > 0 ? `,rejected=${r.rejected.length}` : ''
  const future = hidden > 0 ? `,hidden_future=${hidden}` : ''
  return `${r.callReason ?? `proposed=${r.proposed}`}${rejected}${future}`
}

async function helpOne(input: KnowledgeJobInput): Promise<string> {
  const cards = await cardsAsOf(input.now, 200)
  const have = new Set(cards.map((c) => c.topic))
  const next = TRADING_SETTINGS.find((s) => !have.has(helpTopic(s.key)))
  if (!next) return 'none'
  const r = await makeSettingHelp(next.key, input.model)
  return r.made ? `done:${next.key}` : r.reason
}
