import 'server-only'

/**
 * 이벤트 표 읽고 쓰기 (§6.6)
 *
 * 서비스롤로 지나간다 — 표에 정책이 하나도 없고, 사람 확인은 창구
 * (`app/(member)/trading/actions.ts`)에서 `tradingAccess` 로 한 번만 한다.
 * 두 곳에서 각자 확인하면 두 판정이 갈리고, 갈린 결과가
 * 「화면은 열리는데 창구가 403」 이거나 그 반대다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { windowFor, type MarketEvent } from './events-core.ts'

export interface EventRow extends MarketEvent {
  id: string
  note: string | null
}

/** 이 판정에 필요한 구간만 읽는다. 표 전체를 매분 훑지 않는다 */
export async function loadEventsAround(
  at: Date, beforeMinutes: number, afterMinutes: number,
): Promise<MarketEvent[]> {
  const w = windowFor(at, beforeMinutes, afterMinutes)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_events')
    .select('name, occurs_at')
    .gte('occurs_at', w.from.toISOString())
    .lte('occurs_at', w.until.toISOString())
  if (error) throw new Error(`이벤트를 읽지 못했습니다: ${error.message}`)
  return ((data ?? []) as { name: string; occurs_at: string }[])
    .map((r) => ({ name: r.name, occursAt: r.occurs_at }))
}

/** 화면이 그릴 목록. 지난 것도 조금 보여야 「등록했는데 어디 갔지」가 안 생긴다 */
export async function listEvents(limit = 50): Promise<EventRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_events')
    .select('id, name, occurs_at, note')
    .order('occurs_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`이벤트 목록을 읽지 못했습니다: ${error.message}`)
  return ((data ?? []) as { id: string; name: string; occurs_at: string; note: string | null }[])
    .map((r) => ({ id: r.id, name: r.name, occursAt: r.occurs_at, note: r.note }))
}

export type AddEventResult =
  | { ok: true; id: string }
  | { ok: false; reason: string; userMessage: string }

/**
 * 하나 더한다. **거절 사유를 사람 말로 돌려준다** —
 * 조용히 안 들어가면 관리자는 넣은 줄 알고 그 구간에 신호가 나간다.
 */
export async function addEvent(input: {
  name: string; occursAt: string; note?: string | null
}): Promise<AddEventResult> {
  const name = input.name.trim()
  if (name === '') {
    return { ok: false, reason: 'empty_name', userMessage: '이벤트 이름을 적어 주세요' }
  }
  const at = new Date(input.occursAt)
  if (!Number.isFinite(at.getTime())) {
    return { ok: false, reason: 'bad_time', userMessage: '시각을 읽지 못했습니다' }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_events')
    .insert({ name, occurs_at: at.toISOString(), note: input.note ?? null, source: 'manual' })
    .select('id')
    .maybeSingle()
  /**
   * supabase-js 는 실패를 **던지지 않고 돌려준다.** 안 보면 0건이 조용히 지나간다.
   * 유일 키(name, occurs_at)에 걸린 것은 실수가 아니라 이미 넣은 것이라 따로 말한다.
   */
  if (error) {
    const duplicate = (error.code as string | undefined) === '23505'
    return {
      ok: false,
      reason: duplicate ? 'duplicate' : `insert_failed:${error.message}`,
      userMessage: duplicate ? '같은 이름과 시각의 이벤트가 이미 있습니다' : '이벤트를 저장하지 못했습니다',
    }
  }
  if (!data?.id) {
    return { ok: false, reason: 'no_row', userMessage: '이벤트를 저장하지 못했습니다' }
  }
  return { ok: true, id: data.id as string }
}

/** 하나 지운다. 되돌리기를 안 두는 이유: 이벤트는 다시 넣으면 그만이다 */
export async function removeEvent(id: string): Promise<{ ok: boolean; userMessage: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_events').delete().eq('id', id)
  if (error) return { ok: false, userMessage: '이벤트를 지우지 못했습니다' }
  return { ok: true, userMessage: null }
}
