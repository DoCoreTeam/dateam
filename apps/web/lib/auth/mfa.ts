import 'server-only'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { AalLevel } from './mfa-level.ts'

// 판정 규칙은 mfa-level 에 있다 (테스트가 읽을 수 있게). 부르는 쪽 편의를 위해 여기서도 내보낸다.
export { needsChallenge } from './mfa-level.ts'

/**
 * 2단계 인증 (TOTP)
 *
 * **왜**: 2026-09-20 실측 — 계정 40개 중 2단계 인증을 쓰는 사람이 **0명**이었고
 * 그중 둘은 관리자였다. 표 잠금도, 창구 게이트도, 헤더도 결국 로그인 하나에 매달려 있다.
 * 관리자 비밀번호 하나가 새면 지금까지 닫은 것이 전부 무의미해진다.
 *
 * **왜 직접 안 만드나**: Supabase 인증이 TOTP 를 이미 한다. 비밀키 보관, 시간 오차 허용,
 * 재사용 차단이 전부 그쪽에 있다. 암호를 우리가 새로 짜면 그 셋을 우리가 틀린다.
 *
 * **어떻게 강제되나**: 검증된 장치가 있는 사람은 비밀번호만으로는 aal1 에 머물고,
 * 코드를 넣어야 aal2 가 된다. 미들웨어가 그 차이를 보고 `/mfa` 로 보낸다.
 * 세션 토큰이 그 사실을 담고 있어 **추가 왕복이 없다.**
 */

export type MfaFactor = {
  id: string
  friendlyName: string | null
  status: 'verified' | 'unverified'
  createdAt: string
}

export type MfaState = {
  /** 검증까지 끝난 장치 (이게 있으면 로그인에 코드가 필요하다) */
  verified: MfaFactor[]
  /** 등록하다 만 것 — 화면에서 치울 수 있게 함께 준다 */
  pending: MfaFactor[]
  /** 지금 세션이 2단계까지 통과했나 */
  currentLevel: AalLevel
  /** 이 세션이 도달해야 하는 단계 */
  nextLevel: AalLevel
}

/** 지금 로그인한 사람의 2단계 인증 상태. */
export async function getMfaState(): Promise<MfaState> {
  const supabase = await createClient()

  const [{ data: factors }, { data: aal }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ])

  const all = (factors?.all ?? []).map((f) => ({
    id: f.id,
    friendlyName: f.friendly_name ?? null,
    status: f.status as 'verified' | 'unverified',
    createdAt: f.created_at,
  }))

  return {
    verified: all.filter((f) => f.status === 'verified'),
    pending: all.filter((f) => f.status !== 'verified'),
    currentLevel: (aal?.currentLevel as AalLevel) ?? null,
    nextLevel: (aal?.nextLevel as AalLevel) ?? null,
  }
}

/**
 * 관리자에게 2단계를 요구하는가. 설정은 DB 에 둔다 (env 를 새로 만들지 않는다).
 * 값이 없으면 요구하지 않는다 — 켜는 것은 사람의 결정이다.
 */
export async function isMfaRequiredForAdmin(): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('system_settings')
    .select('value')
    .eq('key', 'mfa_required_for_admin')
    .maybeSingle()
  return data?.value === 'true'
}
