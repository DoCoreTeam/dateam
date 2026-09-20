'use server'

// app/admin/ai-usage/actions.ts — 관리자가 기능별 하루 상한을 바꾼다
//
// ## 왜 서버 액션인가
//
// 상한은 **브라우저가 직접 고칠 수 없어야 한다**. ai_call_budget 에 쓰기 정책을 안 둔 것이
// 그 뜻이고(마이그 263), 그래서 바꾸는 길은 서버를 지나야 한다. 여기서 사람을 확인하고
// 서비스롤로 쓴다 — 서비스롤은 RLS 를 통째로 지나가므로 그 위에 사람 확인이 반드시 있어야 한다.

import { revalidatePath } from 'next/cache'
import { createAdminClient, getRequestUser } from '@/lib/supabase/server'
import { toBudgetLimit } from '@/lib/ai/budget'

export interface SaveLimitResult {
  ok: boolean
  error?: string
}

/** 하루 상한이 가질 수 있는 최대치. 사람이 0 을 하나 더 붙이는 실수를 막는다 */
const MAX_DAILY = 100_000
const MAX_PER_MINUTE = 1_000

export async function saveAiBudget(input: {
  feature: string
  dailyLimit: number
  perMinuteLimit: number
  enabled: boolean
}): Promise<SaveLimitResult> {
  const user = await getRequestUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any
  const { data: profile } = await adm.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return { ok: false, error: '관리자만 바꿀 수 있습니다.' }

  const feature = input.feature.trim()
  if (!feature) return { ok: false, error: '기능 이름이 없습니다.' }

  // 밖에서 온 값이다. 표에 넣기 전에 여기서 자른다
  const daily = Math.floor(Number(input.dailyLimit))
  const perMinute = Math.floor(Number(input.perMinuteLimit))
  if (!Number.isFinite(daily) || daily < 0 || daily > MAX_DAILY) {
    return { ok: false, error: `하루 상한은 0 에서 ${MAX_DAILY.toLocaleString('ko-KR')} 사이여야 합니다.` }
  }
  if (!Number.isFinite(perMinute) || perMinute < 1 || perMinute > MAX_PER_MINUTE) {
    return { ok: false, error: `분당 상한은 1 에서 ${MAX_PER_MINUTE.toLocaleString('ko-KR')} 사이여야 합니다.` }
  }

  const row = {
    feature,
    daily_limit: daily,
    per_minute_limit: perMinute,
    enabled: Boolean(input.enabled),
  }
  // 우리 모양으로 한 번 통과시켜 본다 — 표에 넣고 나서 못 읽는 값이면 그 기능은 조용히 상한이 없어진다
  if (!toBudgetLimit(row)) return { ok: false, error: '상한 값이 올바르지 않습니다.' }

  // supabase-js 는 오류를 던지지 않고 돌려준다. 안 보면 「저장됐습니다」라고 거짓말한다
  const { error } = await adm.from('ai_call_budget').upsert(row, { onConflict: 'feature' })
  if (error) {
    console.error('[ai-usage] 상한 저장 실패', error.message ?? error)
    return { ok: false, error: '상한을 저장하지 못했습니다.' }
  }

  revalidatePath('/admin/ai-usage')
  return { ok: true }
}
