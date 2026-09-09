/**
 * 사용량과 요금제 상한 (설계서 F12)
 *
 * ## 원장을 따로 두는 이유
 *
 * 호출 기록(`rfp_llm_calls`)은 케이스를 지우면 함께 사라진다.
 * **청구 근거는 사라지면 안 된다.** 그래서 조직·월 단위로 접은 원장을 따로 둔다.
 *
 * ## 상한을 넘으면 막되, 막힌 이유를 말한다
 *
 * 「분석 실패」로만 두면 사용자는 시스템이 고장 난 줄 안다.
 * 「이번 달 한도를 넘었다」와 「관리자에게 요금제를 올려 달라고 하라」까지 말해야 한다.
 */

export type UsageKind = 'llm' | 'image_text' | 'commercial_parser'

export const USAGE_KINDS: readonly UsageKind[] = ['llm', 'image_text', 'commercial_parser']

export interface UsageRow {
  orgId: string
  /** 'YYYY-MM' (KST) */
  period: string
  kind: UsageKind
  units: number
  costKrw: number
}

export interface Plan {
  id: string
  name: string
  /** null 이면 무제한. 0 을 무제한으로 쓰면 「0건까지 허용」과 구분이 안 된다 */
  monthlyCaseLimit: number | null
  monthlyAiKrw: number | null
  maxMembers: number | null
  crossVerify: boolean
  assistant: boolean
}

/** 이번 달 (KST) — 서버가 UTC 라도 사용자의 달을 쓴다 */
export function currentPeriod(now: number = Date.now()): string {
  const kst = new Date(now + 9 * 3600_000)
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`
}

export interface UsageSummary {
  period: string
  costKrw: number
  byKind: Record<string, { units: number; costKrw: number }>
}

/** 원장을 이번 달 요약으로 접는다 */
export function summarize(rows: readonly UsageRow[], period: string): UsageSummary {
  const byKind: Record<string, { units: number; costKrw: number }> = {}
  let costKrw = 0
  for (const r of rows) {
    if (r.period !== period) continue
    const hit = byKind[r.kind] ?? { units: 0, costKrw: 0 }
    hit.units += r.units
    hit.costKrw += r.costKrw
    byKind[r.kind] = hit
    costKrw += r.costKrw
  }
  return { period, costKrw, byKind }
}

export type QuotaReason = 'ai_budget_exceeded' | 'case_limit_exceeded' | 'member_limit_exceeded' | 'feature_not_in_plan'

export type QuotaCheck =
  | { ok: true }
  | { ok: false; reason: QuotaReason; used: number; limit: number; message: string }

/** 막힌 이유마다 다음에 무엇을 하면 되는지 */
const QUOTA_MESSAGE: Record<QuotaReason, string> = {
  ai_budget_exceeded: '이번 달 AI 비용 한도를 넘었습니다. 관리자에게 요금제 상향을 요청해 주세요',
  case_limit_exceeded: '이번 달 케이스 수 한도를 넘었습니다. 다음 달에 다시 시도하거나 요금제를 올려 주세요',
  member_limit_exceeded: '요금제의 구성원 수 한도를 넘었습니다',
  feature_not_in_plan: '지금 요금제에는 이 기능이 없습니다. 관리자에게 요금제 상향을 요청해 주세요',
}

export interface QuotaInput {
  plan: Plan
  usage: UsageSummary
  /** 이번 달 만든 케이스 수 */
  caseCount: number
  memberCount: number
  /** 지금 하려는 일 */
  action: 'create_case' | 'run_analysis' | 'run_cross' | 'use_assistant' | 'add_member'
  /** 이번 호출로 더 들 비용 */
  addKrw?: number
}

/**
 * 요금제 상한을 넘나.
 *
 * `null` 은 무제한이다 — 0 과 구분한다.
 */
export function checkQuota(input: QuotaInput): QuotaCheck {
  const { plan, usage } = input

  if (input.action === 'run_cross' && !plan.crossVerify) {
    return deny('feature_not_in_plan', 0, 0)
  }
  if (input.action === 'use_assistant' && !plan.assistant) {
    return deny('feature_not_in_plan', 0, 0)
  }
  if (input.action === 'add_member' && plan.maxMembers !== null && input.memberCount >= plan.maxMembers) {
    return deny('member_limit_exceeded', input.memberCount, plan.maxMembers)
  }
  if (input.action === 'create_case' && plan.monthlyCaseLimit !== null && input.caseCount >= plan.monthlyCaseLimit) {
    return deny('case_limit_exceeded', input.caseCount, plan.monthlyCaseLimit)
  }
  if (plan.monthlyAiKrw !== null) {
    const after = usage.costKrw + (input.addKrw ?? 0)
    if (after > plan.monthlyAiKrw) {
      return deny('ai_budget_exceeded', Math.round(usage.costKrw), plan.monthlyAiKrw)
    }
  }
  return { ok: true }
}

function deny(reason: QuotaReason, used: number, limit: number): QuotaCheck {
  return { ok: false, reason, used, limit, message: QUOTA_MESSAGE[reason] }
}

/** DB 행 → 요금제 */
export function toPlan(row: Record<string, unknown>): Plan {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    monthlyCaseLimit: nullableInt(row.monthly_case_limit),
    monthlyAiKrw: nullableInt(row.monthly_ai_krw),
    maxMembers: nullableInt(row.max_members),
    crossVerify: Boolean(row.cross_verify),
    assistant: Boolean(row.assistant),
  }
}

function nullableInt(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 원장에 더할 값 — 워커가 부른다 */
export function usageDelta(
  orgId: string, kind: UsageKind, units: number, costKrw: number, now = Date.now(),
): UsageRow {
  return { orgId, period: currentPeriod(now), kind, units, costKrw }
}
