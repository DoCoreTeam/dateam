// lib/ai/usage-query.ts — 원장에서 「오늘 얼마나 썼나」를 만든다 (순수 집계)
//
// ## 왜 원장을 보나
//
// 관리자 사용량 화면이 `ai_token_logs` 를 읽고 있었다. 그 표는 토큰 수를 적는 자리고,
// **안 나간 호출은 아예 없다** — 한도에 걸려 거절된 것도, 저장된 답으로 해결해 안 부른 것도
// 거기엔 안 남는다. 실측 2026-09-20: 사흘 50,243건 중 47,055건이 실패였는데 그 화면은
// 성공한 호출의 토큰만 보여 주고 있었다. 「왜 이렇게 많이 나갔나」에 답할 수 없는 화면이었다.
//
// 원장(ai_llm_calls)은 거절도 실패도 적는다. 그래서 여기서 읽는다.
//
// ## 왜 순수 함수인가
//
// 집계를 왕복 안에 섞으면 확인하려고 Supabase 를 세워야 하고, 그렇게 세운 시험은 셈이 아니라
// 연결을 본다. 여기는 **읽어 온 줄**을 받아 숫자만 만든다.

import { decideBudget, pickLimit, BUDGET_FALLBACK_KEY, type BudgetLimit } from './budget.ts'

/** 원장 한 줄에서 집계에 필요한 것만 */
export interface CallRow {
  surface: string
  ok: boolean
  error: string | null
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
}

export interface FeatureUsage {
  feature: string
  /** 오늘 원장에 남은 줄 수 — 거절도 포함한다 */
  total: number
  /** 실제로 벤더에 닿아 성공한 것 */
  ok: number
  /** 벤더까지 갔는데 실패한 것 (한도·네트워크·형식) */
  failed: number
  /** 상한에 걸려 **나가지도 않은** 것 */
  denied: number
  inputTokens: number
  outputTokens: number
  /** 상한이 있으면 남은 횟수, 모르면 null */
  remaining: number | null
  limit: BudgetLimit | null
}

/** 거절은 원장에 이 말머리로 남는다 (lib/ai/budget.ts 의 BudgetDeniedError) */
const DENIED = 'ai_budget_denied'

export function isDenied(row: Pick<CallRow, 'ok' | 'error'>): boolean {
  return !row.ok && (row.error ?? '').startsWith(DENIED)
}

/**
 * 기능별로 접는다.
 *
 * **거절을 실패와 따로 센다.** 둘을 합치면 「벤더가 거절했다」와 「우리가 안 보냈다」가
 * 같은 숫자가 되고, 그러면 상한을 올려야 하는지 프롬프트를 고쳐야 하는지 못 가린다.
 */
/**
 * 이 창구에 실제로 걸리는 상한.
 *
 * 화면이 정확히 같은 이름만 찾으면, 물려받아 걸리는 상한을 「상한 없음」으로 그린다 —
 * 그러면 관리자가 없는 줄을 또 만들고 좁은 줄이 넓은 줄을 덮어 버린다.
 * 게이트와 **같은 규칙**을 쓰는 것이 요점이다.
 */
function limitFor(surface: string, limits: ReadonlyMap<string, BudgetLimit>): BudgetLimit | null {
  return pickLimit(surface, [...limits.values()])
}

export function foldByFeature(
  rows: readonly CallRow[],
  limits: ReadonlyMap<string, BudgetLimit>,
  now: Date = new Date(),
): FeatureUsage[] {
  const acc = new Map<string, FeatureUsage>()

  for (const r of rows) {
    const f = r.surface || '(미상)'
    let u = acc.get(f)
    if (!u) {
      u = {
        feature: f, total: 0, ok: 0, failed: 0, denied: 0,
        inputTokens: 0, outputTokens: 0, remaining: null, limit: limitFor(f, limits),
      }
      acc.set(f, u)
    }
    u.total += 1
    if (r.ok) u.ok += 1
    else if (isDenied(r)) u.denied += 1
    else u.failed += 1
    u.inputTokens += r.input_tokens ?? 0
    u.outputTokens += r.output_tokens ?? 0
  }

  // 상한만 있고 오늘 한 건도 안 부른 기능도 보여 준다 — 0 도 답이다.
  // 받아 주는 줄(`*`)은 창구가 아니라 규칙이므로 줄로 세우지 않는다
  for (const [feature, limit] of limits) {
    if (feature === BUDGET_FALLBACK_KEY) continue
    if (!acc.has(feature)) {
      acc.set(feature, {
        feature, total: 0, ok: 0, failed: 0, denied: 0,
        inputTokens: 0, outputTokens: 0, remaining: null, limit,
      })
    }
  }

  for (const u of acc.values()) {
    if (!u.limit) { u.remaining = null; continue }
    /*
      남은 횟수는 **나간 것만** 뺀다. 거절은 벤더에 안 닿았으므로 한도를 안 썼다 —
      거절까지 빼면 「막혔는데 남은 것도 줄어든다」가 되어 숫자가 사람을 속인다.
    */
    const used = u.total - u.denied
    const d = decideBudget(u.limit, { usedToday: used, usedLastMinute: 0, oldestInWindowIso: null }, now)
    u.remaining = d.allowed ? Math.max(0, u.limit.dailyLimit - used) : 0
  }

  return [...acc.values()].sort((a, b) => b.total - a.total)
}

/** 화면 맨 위 한 줄 */
export interface UsageTotals {
  total: number
  ok: number
  failed: number
  denied: number
  inputTokens: number
  outputTokens: number
  /** 상한을 가진 기능 중 오늘 한도를 다 쓴 것 */
  exhausted: number
}

export function totalsOf(rows: readonly FeatureUsage[]): UsageTotals {
  return rows.reduce<UsageTotals>((t, u) => ({
    total: t.total + u.total,
    ok: t.ok + u.ok,
    failed: t.failed + u.failed,
    denied: t.denied + u.denied,
    inputTokens: t.inputTokens + u.inputTokens,
    outputTokens: t.outputTokens + u.outputTokens,
    exhausted: t.exhausted + (u.limit && u.remaining === 0 ? 1 : 0),
  }), { total: 0, ok: 0, failed: 0, denied: 0, inputTokens: 0, outputTokens: 0, exhausted: 0 })
}
