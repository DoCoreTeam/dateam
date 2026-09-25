/**
 * 지식 작업 순서 — **맨 뒤다** (명세 §10.2)
 *
 * ## 왜 맨 뒤인가
 *
 * 지식은 곁가지다. 포지션 감시·신호 발행보다 먼저 돌면, AI 가 느린 날 그 분의
 * **수집과 판단이 통째로 밀린다.** 그리고 밀린 봉은 다시 안 온다.
 *
 * ## 왜 한 분에 하나씩인가
 *
 * 여섯 가지를 한 분에 다 하면 50초를 쉽게 넘고, 넘으면 다음 분 실행과 겹친다.
 * 그래서 매분 **하나만** 하고 나머지는 다음 실행으로 넘긴다 — 지식은 급하지 않다.
 */

/**
 * 순서. **들고 있는 것이 먼저다.**
 *
 * 청산 섀도가 맨 앞인 이유: 지나간 신호를 설명하는 일보다 지금 들고 있는 포지션이
 * 급하다. 장 안에서든 밖에서든 같다 — 순서가 두 갈래면 언젠가 갈린다.
 */
export const KNOWLEDGE_TASKS = [
  /** 보유 중이면 청산 판단 섀도 */
  'exit_shadow',
  /** 아직 설명 없는 신호 */
  'explain_signal',
  /** 아직 분석 안 한 자료 */
  'analyze_source',
  /** 하루 한 번 패턴 리포트 */
  'pattern_report',
  /** 분석 끝난 자료를 지식 카드로 */
  'knowledge_card',
  /** 리포트가 있으면 스펙 후보 */
  'spec_candidate',
  /** 설명 없는 설정에 도우미 */
  'setting_help',
] as const
export type KnowledgeTask = (typeof KNOWLEDGE_TASKS)[number]

export const TASK_LABEL: Record<KnowledgeTask, string> = {
  exit_shadow: '청산 판단 섀도',
  explain_signal: '신호 설명',
  analyze_source: '자료 분석',
  pattern_report: '패턴 리포트',
  knowledge_card: '지식 카드',
  spec_candidate: '설정 후보',
  setting_help: '설정 도우미',
}

export interface KnowledgeContext {
  /** 분석 안 한 자료 수 */
  pendingSources: number
  /** 설명 없는 신호 수 */
  unexplainedSignals: number
  /** 지금 포지션을 들고 있나 */
  holdingPosition: boolean
  /** 오늘 리포트를 이미 만들었나 */
  reportMadeToday: boolean
  /** 대기 중인 후보가 있나. 있으면 새로 안 낸다 — 사람이 고를 것이 쌓이면 안 고른다 */
  hasOpenProposal: boolean
  /** 도우미가 아직 없는 설정 수 */
  settingsWithoutHelp: number
  /** 카드로 안 옮긴, 분석 끝난 자료 수 */
  uncardedSources: number
  /** 이번 실행이 시작하고 지난 밀리초 */
  elapsedMs: number
  /** 한 실행의 상한 */
  budgetMs: number
  /** 지식 작업 하나에 걸린다고 보는 밀리초 */
  perTaskMs: number
  /** 정규장 접속매매 중인가. 장중에는 급한 것만 한다 */
  continuousTrading: boolean
}

export type KnowledgePick =
  | { task: KnowledgeTask }
  | { task: null; reason: 'no_time' | 'nothing_to_do' }

/**
 * 이번 분에 무엇을 하나. **하나만 고른다.**
 *
 * 장중에는 청산 섀도와 신호 설명만 한다 — 나머지는 지금 안 해도 되고,
 * 장중에 AI 를 부르면 그만큼 다음 분의 여유가 줄어든다.
 */
export function pickKnowledgeTask(ctx: KnowledgeContext): KnowledgePick {
  if (ctx.budgetMs - ctx.elapsedMs < ctx.perTaskMs) {
    return { task: null, reason: 'no_time' }
  }

  const duringSession: KnowledgeTask[] = ['exit_shadow', 'explain_signal']
  const order: KnowledgeTask[] = ctx.continuousTrading ? duringSession : [...KNOWLEDGE_TASKS]

  for (const task of order) {
    if (task === 'analyze_source' && ctx.pendingSources > 0) return { task }
    if (task === 'explain_signal' && ctx.unexplainedSignals > 0) return { task }
    if (task === 'exit_shadow' && ctx.holdingPosition) return { task }
    if (task === 'pattern_report' && !ctx.reportMadeToday) return { task }
    if (task === 'knowledge_card' && ctx.uncardedSources > 0) return { task }
    if (task === 'spec_candidate' && ctx.reportMadeToday && !ctx.hasOpenProposal) return { task }
    if (task === 'setting_help' && ctx.settingsWithoutHelp > 0) return { task }
  }
  return { task: null, reason: 'nothing_to_do' }
}

/** 실행 기록에 실을 한 줄 */
export function knowledgeReason(pick: KnowledgePick, outcome?: string): string {
  if (pick.task === null) return `knowledge=${pick.reason}`
  return `knowledge=${pick.task}${outcome ? `:${outcome}` : ''}`
}
