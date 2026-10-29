// lib/ai/token-summary.ts — 사용량 화면 위 카드 셋(오늘, 이번 달, 누적)의 셈 (순수)
//
// ## 왜 따로 셈하나
//
// 예전에는 `total_tokens.sum()` 을 PostgREST 에 맡겼다. 이 프로젝트는 집계 함수를 꺼 두어서
// PGRST123 이 나는데, 오류를 안 읽어 카드가 늘 0 이었다. 실측 2026-10-29: 오늘 75,331,
// 이번 달 1,579,163 으로 임계치 1,000,000 을 넘었는데 화면은 0 이었고 경고도 안 떴다.
// 줄을 받아 여기서 더한다. 경계는 KST 다 — 서버 시계(UTC)로 자르면 오전 9시 전 호출이 어제로 간다.

import { kstRangeToUtc, kstTodayKey } from '../datetime/kst.ts'

export interface TokenRow {
  created_at: string
  total_tokens: number | null
}

export interface TokenSummary {
  today_tokens: number
  month_tokens: number
  total_tokens: number
}

/** 오늘과 이번 달이 시작하는 UTC 시각 (KST 자정 기준) */
export function kstBounds(now: Date = new Date()): { todayFromIso: string; monthFromIso: string } {
  const today = kstTodayKey(now)
  return {
    todayFromIso: kstRangeToUtc(today, today).fromIso,
    monthFromIso: kstRangeToUtc(`${today.slice(0, 7)}-01`, today).fromIso,
  }
}

export function sumTokens(rows: readonly TokenRow[], now: Date = new Date()): TokenSummary {
  const { todayFromIso, monthFromIso } = kstBounds(now)
  const todayFrom = Date.parse(todayFromIso)
  const monthFrom = Date.parse(monthFromIso)
  let today = 0
  let month = 0
  let total = 0
  for (const r of rows) {
    const n = r.total_tokens ?? 0
    const at = Date.parse(r.created_at)
    total += n
    if (at >= monthFrom) month += n
    if (at >= todayFrom) today += n
  }
  return { today_tokens: today, month_tokens: month, total_tokens: total }
}
