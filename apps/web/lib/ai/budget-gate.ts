// lib/ai/budget-gate.ts — 상한과 실제 사용량을 DB 에서 읽어 판정한다 (서버 전용)
//
// 규칙은 순수 계층(budget.ts)에 있고 여기는 세는 일만 한다. 판단을 왕복 안에 섞으면
// 확인하려고 Supabase 를 세워야 하고, 그렇게 세운 시험은 규칙이 아니라 연결을 본다.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { decideBudget, toBudgetLimit, budgetKeysFor, pickLimit, type BudgetDecision } from './budget.ts'
import { kstDateKey, kstWallToIso } from '../datetime/kst.ts'

// 던지는 쪽이 이 모듈(서비스롤·server-only)을 안 끌어오게 규칙 계층에 두고 여기서 다시 낸다
export { BudgetDeniedError } from './budget.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 예산을 묻는 창구. 테스트는 가짜를 끼운다 */
export interface BudgetGate {
  check(feature: string, now?: Date): Promise<BudgetDecision>
}

const MINUTE_MS = 60_000

/*
  거절된 줄은 사용량이 아니다.

  거절도 원장에 남는다(화면이 「막혔다」를 보여야 하므로). 그 줄까지 세면 몰려서 거절이 날수록
  그날 상한이 실제 호출보다 빨리 차고, 분당 창은 거절이 거절을 부른다 (실측 2026-10-29 최근 7일 거절 157건).
  벤더로 나간 호출은 성공이든 실패든 계속 센다 — 실패도 공급자 한도를 쓴다.
  `not like` 만 걸면 오류가 NULL 인 성공 줄까지 빠진다(NULL 비교는 참이 아니다). 그래서 둘을 or 로 건다.
*/
const NOT_DENIED = 'error.is.null,error.not.like.ai_budget_denied*'

/**
 * 진짜로 세는 창구.
 *
 * ## 못 읽으면 통과시킨다
 *
 * 상한을 못 읽거나 사용량을 못 세면 «모른다»이고, 그때는 막지 않는다.
 * 셈이 안 된다고 사용자의 일을 멈추면 관측 장치가 새 단일 장애점이 된다
 * (이 저장소는 그 사고를 이미 겪었다 — 원장을 못 적으면 AI 가 전부 죽었다).
 */
export function serverBudgetGate(): BudgetGate {
  return {
    async check(feature: string, now: Date = new Date()): Promise<BudgetDecision> {
      try {
        const db = createAdminClient() as any

        /*
          정확히 같은 이름만 찾으면 안 된다.

          상한 표에 `crm` 한 줄이 있는데 원장에 남는 창구 이름은 `crm/quick_create` 였고,
          그래서 그 상한이 **한 번도 안 걸렸다**. 켜 놨다고 생각한 동안 무제한이었다
          (실측 2026-09-20: 창구 마흔하나 중 서른둘이 같은 상태).
          이제 좁은 이름부터 넓은 이름까지 한 번에 읽고 가장 좁은 것을 쓴다.
        */
        const keys = budgetKeysFor(feature)
        const { data: rows, error: limitErr } = await db
          .from('ai_call_budget')
          .select('feature, daily_limit, per_minute_limit, enabled')
          .in('feature', keys)

        // supabase-js 는 오류를 던지지 않고 돌려준다. 안 읽으면 조용히 「상한 없음」이 된다
        if (limitErr) {
          console.error('[ai] 상한 읽기 실패', limitErr.message ?? limitErr)
          return decideBudget(null, emptyUsage(), now)
        }
        const limit = pickLimit(feature, ((rows ?? []) as unknown[]).map(toBudgetLimit))
        // 줄이 없으면 상한을 모르는 것이다. 모르면 막지 않는다
        if (!limit) return decideBudget(null, emptyUsage(), now)

        const dayStartIso = kstWallToIso(kstDateKey(now.toISOString()), '00:00')
        const windowStartIso = new Date(now.getTime() - MINUTE_MS).toISOString()

        const [today, minute] = await Promise.all([
          db.from('ai_llm_calls')
            .select('id', { count: 'exact', head: true })
            .eq('surface', feature)
            .or(NOT_DENIED)
            .gte('created_at', dayStartIso),
          db.from('ai_llm_calls')
            .select('created_at')
            .eq('surface', feature)
            .or(NOT_DENIED)
            .gte('created_at', windowStartIso)
            .order('created_at', { ascending: true })
            .limit(200),
        ])

        if (today.error || minute.error) {
          console.error('[ai] 사용량 세기 실패', (today.error ?? minute.error)?.message)
          return decideBudget(null, emptyUsage(), now)
        }

        const window = (minute.data ?? []) as { created_at: string }[]
        return decideBudget(limit, {
          usedToday: today.count ?? 0,
          usedLastMinute: window.length,
          oldestInWindowIso: window[0]?.created_at ?? null,
        }, now)
      } catch (e) {
        console.error('[ai] 예산 판정 실패', e instanceof Error ? e.message : e)
        return decideBudget(null, emptyUsage(), now)
      }
    },
  }
}

function emptyUsage() {
  return { usedToday: 0, usedLastMinute: 0, oldestInWindowIso: null }
}
