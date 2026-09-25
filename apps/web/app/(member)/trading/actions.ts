'use server'

// app/(member)/trading/actions.ts — 신호 확인 창구
//
// **왜 창구가 하나인가**: 단추 셋이 값을 바꾼다. 화면 안에서 직접 쓰면 소유자 확인이
// 화면마다 흩어지고, 새 화면을 만든 사람이 기억해야 한다. 기억해야 하는 규칙은 빠뜨린다.
//
// **왜 새 인증을 안 만드나**: 레이아웃이 이미 `tradingAccess()` 로 소유자를 거른다.
// 여기서 제 나름의 확인을 만들면 두 판정이 갈리고, 갈린 결과가
// 「화면은 열리는데 창구가 403」 이거나 그 반대다. 같은 함수를 부른다.

import { revalidatePath } from 'next/cache'
import { tradingAccess } from '@/lib/trading/access'
import { applyAck, markOpened } from '@/lib/trading/signal/ack'
import { ACK_ACTIONS, type AckAction } from '@/lib/trading/signal/ack-policy'
import { loadTradingSettings } from '@/lib/trading/settings/store'

export interface AckActionResult {
  ok: boolean
  userMessage: string | null
}

const DENIED: AckActionResult = { ok: false, userMessage: '이 화면의 소유자만 확인할 수 있습니다' }

function seoulToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
}

async function validMinutes(today: string): Promise<number> {
  const { values } = await loadTradingSettings(today)
  const raw = Number(values.signal_valid_minutes)
  return Number.isFinite(raw) && raw > 0 ? raw : 10
}

/** 화면이 신호를 처음 그렸다 */
export async function recordSignalOpened(signalId: string): Promise<AckActionResult> {
  if (!(await tradingAccess()).allowed) return DENIED
  try {
    await markOpened(signalId, new Date())
    return { ok: true, userMessage: null }
  } catch (error) {
    // 열람 기록이 실패해도 화면은 살아 있어야 한다. 곁가지가 본 일을 죽이지 않는다
    return { ok: false, userMessage: error instanceof Error ? error.message : '열람을 적지 못했습니다' }
  }
}

/** 단추 셋 중 하나를 눌렀다 */
export async function submitSignalAck(
  signalId: string, action: string, stopValue?: string,
): Promise<AckActionResult> {
  if (!(await tradingAccess()).allowed) return DENIED
  if (!ACK_ACTIONS.includes(action as AckAction)) {
    return { ok: false, userMessage: '모르는 동작입니다' }
  }
  const now = new Date()
  const outcome = await applyAck({
    signalId,
    action: action as AckAction,
    stopValue,
    now,
    validMinutes: await validMinutes(seoulToday(now)),
  })
  if (!outcome.ok) return { ok: false, userMessage: outcome.userMessage }
  revalidatePath('/trading')
  return { ok: true, userMessage: null }
}
