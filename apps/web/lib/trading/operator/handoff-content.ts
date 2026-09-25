/**
 * 사람에게 넘길 글 — **순수하게 둔다**
 *
 * `handoff.ts` 는 `server-only` 라 시험이 import 할 수 없다. 글을 그 안에 두면
 * 「무엇을·왜·무엇이 있으면 되는지 셋이 들어가는가」를 시험으로 못 묻고,
 * 못 묻는 규칙은 언젠가 한 줄이 빠진다.
 */

import { type CheckResult } from './checks.ts'

/**
 * 점검마다 「무엇이 있으면 되는지」.
 *
 * 없으면 받은 사람이 다시 물어야 한다. 「증권사 조회 실패」만 적혀 있으면
 * 무엇을 해야 하는지 모른다.
 */
export const WHAT_IS_NEEDED: Record<string, string> = {
  bars_complete: 'KIS 조회가 되는지 확인하고, 안 되면 앱키와 접근 시간을 봅니다',
  cron_alive: '배포가 살아 있는지와 크론 설정을 봅니다',
  broker_reachable: '증권사 앱키가 유효한지와 점검 시간이 아닌지 봅니다',
  notify_flowing: '알림 대기 표에서 실패 사유를 보고 그 원인을 고칩니다',
  calibration_present: '검증 단계를 돌려 보정 모델을 만듭니다',
  gate_progress: '관문에서 미달·못 잼 항목을 보고 표본을 더 쌓습니다',
  ai_budget: 'AI 예산 상한을 확인하고 필요하면 올립니다',
  reconciled: '증권사 계좌와 기록을 비교하고 화면에서 확인을 누릅니다',
}

/** `daily_logs` 가 받는 우선순위 넷 중에서. 급한 것은 급하게 */
export function priorityOf(status: CheckResult['status']): 'urgent' | 'high' | 'normal' {
  if (status === 'fail') return 'urgent'
  // 모르는 것은 경고보다 급하다 — 무엇이 문제인지조차 모른다
  if (status === 'unknown') return 'high'
  return 'normal'
}

/** 할 일 글. **무엇을·왜·무엇이 있으면 되는지** 셋이 들어간다 */
export function handoffContent(check: CheckResult): string {
  const needed = WHAT_IS_NEEDED[check.id] ?? '무엇을 확인해야 하는지 화면에서 봅니다'
  const measured = Object.entries(check.measured)
    .map(([k, v]) => `${k}=${v === null ? '없음' : String(v)}`)
    .join(', ')
  return [
    `[AI 트레이딩] ${check.userMessage}`,
    `왜: ${check.reason} (${measured})`,
    `할 일: ${needed}`,
  ].join('\n')
}
