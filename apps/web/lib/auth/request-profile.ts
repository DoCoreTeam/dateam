// lib/auth/request-profile.ts — 로그인 사용자의 profiles 행을 **요청당 1회**만 읽는다
//
// 왜 생겼나 (v0.7.492 퍼포먼스 조사):
//   한 번의 화면 요청에서 같은 행을 세 번 읽고 있었다.
//     · 미들웨어 — role (라우팅 게이트)
//     · 그룹 layout(member·ci·admin) — name · role · theme_preference · …
//     · `getEffectiveTheme()` — theme_preference (루트 layout에서)
//   행 하나를 세 번 왕복하는 것은 순수 낭비다.
//
// 왜 컬럼을 합집합으로 읽나:
//   React `cache()`는 **인자로 키를 잡는다.** 호출부마다 다른 컬럼을 넘기면 캐시가
//   갈라져 다시 세 번이 된다. 행 하나에 컬럼 몇 개 더 붙는 비용은 왕복 두 번보다 훨씬 싸다.
//
// ⚠️ 필터를 여기 넣지 않는다:
//   예전 세 호출부의 조건이 서로 달랐다 — admin만 `.is('deleted_at', null)`을 걸었다.
//   여기서 필터를 걸면 나머지 두 곳의 동작이 조용히 바뀐다. 그래서 **행을 그대로 돌려주고**
//   `deleted_at`을 함께 실어 보낸다. 삭제 여부 판단은 지금까지 판단하던 곳이 그대로 한다.

import { cache } from 'react'
import { createAdminClient, getRequestUser } from '@/lib/supabase/server'

export interface RequestProfile {
  name: string | null
  role: string | null
  theme_preference: string | null
  must_change_password: boolean | null
  onboarding_completed_at: string | null
  onboarding_skipped_at: string | null
  onboarding_step: string | null
  deleted_at: string | null
}

/** 세 호출부가 쓰던 컬럼의 합집합 + 필터 판단에 필요한 `deleted_at`. */
const COLUMNS = [
  'name', 'role', 'theme_preference', 'must_change_password',
  'onboarding_completed_at', 'onboarding_skipped_at', 'onboarding_step', 'deleted_at',
].join(', ')

/**
 * 현재 요청 사용자의 프로필. 비로그인이거나 행이 없으면 null.
 * 조회가 실패해도 null — 프로필을 못 읽었다고 화면이 죽지 않는다(기존 동작 유지).
 */
export const getRequestProfile = cache(async (): Promise<RequestProfile | null> => {
  const user = await getRequestUser()
  if (!user) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminClient = createAdminClient() as any
    const { data } = await adminClient
      .from('profiles')
      .select(COLUMNS)
      .eq('id', user.id)
      .maybeSingle()
    return (data ?? null) as RequestProfile | null
  } catch {
    return null
  }
})
