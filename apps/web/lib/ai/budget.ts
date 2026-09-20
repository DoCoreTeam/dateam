// lib/ai/budget.ts — 남은 AI 호출이 몇 번인지 아는 자리 (순수 계산)
//
// ## 왜 생겼나
//
// 상한을 아는 자리가 한 곳도 없었다. 사슬도 재시도도 냉각도 간격도 각자 맞는 판단인데,
// 아무도 「오늘 몇 번 남았나」를 몰라서 멈추라고 말할 수 있는 자리가 없었다.
//
// 실측 2026-09-20
//   하루 호출 23,318건, 그중 22,131건이 실패 — 무료 등급 하루 예산(약 600건)의 38.9배
//   분당으로는 40.2회, 한도는 5회 — 8배
//   원장 50,243건 전부 주인이 비어 있어 누가 태웠는지도 못 가렸다
//
// ## 왜 순수 함수인가
//
// 판단을 DB 왕복 안에 섞으면 확인하려고 Supabase 를 세워야 하고, 그렇게 세운 시험은
// 규칙이 아니라 연결을 본다. 여기는 «센 숫자»를 받아 «되나 안 되나»만 답한다.
//
// ## 막힐 때 세 가지를 함께 말한다
//
// 무엇에 걸렸는지(하루인지 분당인지), 언제 풀리는지, 지금 몇 번 썼는지.
// 「한도 초과」한 마디는 사람이 할 일을 못 정하게 한다 — 기다릴지 설정을 바꿀지 모른다.

import { kstDateKey, addKstDays, kstWallToIso } from '../datetime/kst.ts'

/** 한 기능의 상한. DB(ai_call_budget)에서 온다 — env 에 새 값을 두지 않는다 */
export interface BudgetLimit {
  feature: string
  /** 하루 몇 번까지. 0 이면 이 기능은 AI 를 안 쓴다는 뜻 */
  dailyLimit: number
  /** 분당 몇 번까지 */
  perMinuteLimit: number
  enabled: boolean
}

/** 원장에서 센 값 */
export interface BudgetUsage {
  /** 오늘(한국시간) 이 기능이 부른 횟수 */
  usedToday: number
  /** 최근 60초 안에 부른 횟수 */
  usedLastMinute: number
  /** 최근 60초 창에서 가장 오래된 호출 시각. 없으면 null */
  oldestInWindowIso: string | null
}

export type BudgetDenyReason = 'daily' | 'per_minute' | 'disabled'

export type BudgetDecision =
  | { allowed: true; remainingToday: number }
  | {
      allowed: false
      reason: BudgetDenyReason
      /** 사용자가 읽을 말. 무엇에 걸렸고 언제 풀리는지 */
      message: string
      /** 언제 다시 되나. ISO. 하루 한도는 다음 자정(한국시간) */
      retryAtIso: string
      usedToday: number
      dailyLimit: number
    }

/** 오늘이 끝나고 한도가 되살아나는 시각 (한국시간 자정) */
export function nextDailyResetIso(now: Date = new Date()): string {
  return kstWallToIso(addKstDays(kstDateKey(now.toISOString()), 1), '00:00')
}

/**
 * 이 호출을 보내도 되나.
 *
 * ## 못 읽으면 통과시킨다
 *
 * `limit` 이 null 이면 «상한을 모른다»는 뜻이고, 그때는 막지 않는다.
 * 셈이 안 된다고 사용자의 일을 멈추는 것은 관측 장치가 장애 원인이 되는 것이다
 * (이 저장소는 그 사고를 이미 한 번 겪었다 — 원장을 못 적으면 AI 가 전부 죽었다).
 * 상한이 있는데 못 지키는 것과, 상한이 무엇인지 모르는 것은 다르다.
 */
export function decideBudget(
  limit: BudgetLimit | null,
  usage: BudgetUsage,
  now: Date = new Date(),
): BudgetDecision {
  if (!limit) return { allowed: true, remainingToday: Number.POSITIVE_INFINITY }

  if (!limit.enabled) {
    return {
      allowed: false,
      reason: 'disabled',
      message: `${limit.feature} 의 AI 사용이 꺼져 있습니다. 관리자 설정에서 켜 주세요.`,
      retryAtIso: nextDailyResetIso(now),
      usedToday: usage.usedToday,
      dailyLimit: limit.dailyLimit,
    }
  }

  if (usage.usedToday >= limit.dailyLimit) {
    const retryAtIso = nextDailyResetIso(now)
    return {
      allowed: false,
      reason: 'daily',
      message:
        `AI 하루 한도 소진 · ${limit.feature} 오늘 ${usage.usedToday}/${limit.dailyLimit}회 — `
        + '내일 0시에 다시 됩니다. 더 필요하면 관리자 설정에서 한도를 올려 주세요.',
      retryAtIso,
      usedToday: usage.usedToday,
      dailyLimit: limit.dailyLimit,
    }
  }

  if (usage.usedLastMinute >= limit.perMinuteLimit) {
    /*
      분당 창은 «가장 오래된 호출로부터 60초»에 풀린다. 그 시각을 모르면(창이 비었는데
      숫자만 들어온 경우) 그냥 60초 뒤로 둔다 — 지어낸 시각을 주는 것보다 낫다.
    */
    const base = usage.oldestInWindowIso ? Date.parse(usage.oldestInWindowIso) : NaN
    const retryAt = Number.isFinite(base) ? new Date(base + 60_000) : new Date(now.getTime() + 60_000)
    const waitSec = Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000))
    return {
      allowed: false,
      reason: 'per_minute',
      message:
        `AI 분당 한도 · ${limit.feature} 방금 ${usage.usedLastMinute}/${limit.perMinuteLimit}회 — `
        + `${waitSec}초 뒤에 다시 됩니다.`,
      retryAtIso: retryAt.toISOString(),
      usedToday: usage.usedToday,
      dailyLimit: limit.dailyLimit,
    }
  }

  return { allowed: true, remainingToday: limit.dailyLimit - usage.usedToday }
}

/**
 * 상한 줄 하나를 DB 모양에서 우리 모양으로.
 *
 * 값이 이상하면 **null 을 준다** — 0 이나 음수를 그대로 쓰면 그 기능이 조용히 통째로
 * 막힌다. 모르는 것은 모른다고 하고 통과시키는 편이 낫다.
 */
export function toBudgetLimit(row: unknown): BudgetLimit | null {
  const r = row as {
    feature?: unknown; daily_limit?: unknown; per_minute_limit?: unknown; enabled?: unknown
  } | null
  if (!r || typeof r.feature !== 'string' || !r.feature.trim()) return null

  const daily = Number(r.daily_limit)
  const perMinute = Number(r.per_minute_limit)
  if (!Number.isInteger(daily) || daily < 0) return null
  if (!Number.isInteger(perMinute) || perMinute < 1) return null

  return {
    feature: r.feature.trim(),
    dailyLimit: daily,
    perMinuteLimit: perMinute,
    enabled: r.enabled !== false,
  }
}

/**
 * 상한에 걸려 안 나간 호출. 벤더로는 한 글자도 안 갔다는 뜻이다.
 *
 * ## 왜 순수 계층에 있나
 *
 * 던지는 자리(가림 한 겹·RFP 관문)와 세는 자리(budget-gate.ts)가 다르다. 세는 자리는
 * 서비스롤을 쓰므로 `server-only` 를 달고 있고, 그 모듈을 끌어오는 순간 던지기만 하려던
 * 쪽까지 서버 묶음에 묶인다. 실제로 RFP 관문이 그렇게 묶여 단위 시험 여덟 개가 죽었다.
 * 이름과 모양은 규칙이지 왕복이 아니므로 여기 둔다.
 */
export class BudgetDeniedError extends Error {
  readonly reason: BudgetDenyReason
  readonly retryAtIso: string
  /** 화면에 그대로 띄울 수 있는 말 */
  readonly userMessage: string

  constructor(d: Extract<BudgetDecision, { allowed: false }>) {
    super(`ai_budget_denied(${d.reason}): ${d.message}`)
    this.name = 'BudgetDeniedError'
    this.reason = d.reason
    this.retryAtIso = d.retryAtIso
    this.userMessage = d.message
  }
}
