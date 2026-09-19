'use server'

import { createClient } from '@/lib/supabase/server'

export type ChallengeResult = { ok: true } | { ok: false; error: string }

/**
 * 로그인 두 번째 걸음 — 앱의 여섯 자리를 확인한다.
 *
 * **값으로 돌려주고 이동은 화면이 한다.** 서버 액션 안에서 redirect() 를 하면
 * 기다리던 화면이 undefined 를 받아 「확인 중…」이 영영 안 꺼진다(가드 deploy-fragile ③).
 *
 * 틀린 코드에 「어느 장치인지」나 「몇 번 틀렸는지」를 알려 주지 않는다.
 * 남의 계정에 코드를 찔러 보는 사람에게 단서가 된다.
 */
export async function verifyChallenge(code: string): Promise<ChallengeResult> {
  const clean = code.replace(/\D/g, '')
  if (clean.length !== 6) return { ok: false, error: '여섯 자리 숫자를 입력해 주세요' }

  const supabase = await createClient()
  const { data: factors } = await supabase.auth.mfa.listFactors()
  const factor = (factors?.all ?? []).find((f) => f.status === 'verified')
  // 장치가 없으면 확인할 것이 없다. 화면이 알아서 안으로 들여보낸다.
  if (!factor) return { ok: true }

  const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: factor.id })
  if (cErr || !challenge) return { ok: false, error: '확인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요' }

  const { error } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code: clean,
  })
  if (error) return { ok: false, error: '코드가 맞지 않습니다' }

  return { ok: true }
}

/** 코드를 못 넣는 상황 — 세션을 끊는다. 이동은 화면이 한다. */
export async function cancelChallenge(): Promise<ChallengeResult> {
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut()
  if (error) return { ok: false, error: '로그아웃하지 못했습니다' }
  return { ok: true }
}
