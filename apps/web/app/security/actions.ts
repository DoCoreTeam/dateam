'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

/**
 * 2단계 인증 등록과 해제
 *
 * 등록은 두 걸음이다. 먼저 장치를 만들고(enroll) QR 을 보여 준 뒤,
 * 그 장치가 내놓은 코드로 확인(verify)해야 「검증됨」이 된다.
 * 한 걸음으로 합치면 QR 만 찍고 코드는 안 맞는 상태로 잠길 수 있다.
 */

export type EnrollResult =
  | { ok: true; factorId: string; qr: string; secret: string }
  | { ok: false; error: string }

export type VerifyResult = { ok: true } | { ok: false; error: string }

/** 새 장치를 만들고 QR 을 돌려준다. 아직 로그인에 필요하지 않다. */
export async function startEnroll(): Promise<EnrollResult> {
  const supabase = await createClient()

  // 등록하다 만 것이 쌓이면 목록이 지저분해지고 사람이 어느 것을 찍었는지 모른다.
  const { data: factors } = await supabase.auth.mfa.listFactors()
  for (const f of factors?.all ?? []) {
    if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `등록 ${new Date().toISOString().slice(0, 10)}`,
  })

  if (error || !data) {
    return { ok: false, error: error?.message ?? '장치를 만들지 못했습니다' }
  }
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret }
}

/** 앱이 내놓은 여섯 자리로 확인한다. 통과하면 이 세션도 곧바로 2단계가 된다. */
export async function confirmEnroll(factorId: string, code: string): Promise<VerifyResult> {
  const supabase = await createClient()
  const clean = code.replace(/\D/g, '')
  if (clean.length !== 6) return { ok: false, error: '여섯 자리 숫자를 입력해 주세요' }

  const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId })
  if (cErr || !challenge) return { ok: false, error: cErr?.message ?? '확인을 시작하지 못했습니다' }

  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: clean,
  })
  if (error) return { ok: false, error: '코드가 맞지 않습니다. 앱의 현재 숫자를 다시 확인해 주세요' }

  revalidatePath('/security')
  return { ok: true }
}

/**
 * 장치를 뗀다.
 *
 * 지금 세션이 2단계를 통과한 상태여야 뗄 수 있다. 아니면 비밀번호만 아는 사람이
 * 남의 장치를 떼고 들어갈 수 있다.
 */
export async function removeFactor(factorId: string): Promise<VerifyResult> {
  const supabase = await createClient()
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const { data: factors } = await supabase.auth.mfa.listFactors()
  const target = (factors?.all ?? []).find((f) => f.id === factorId)

  if (target?.status === 'verified' && aal?.currentLevel !== 'aal2') {
    return { ok: false, error: '먼저 코드로 로그인한 뒤에 해제할 수 있습니다' }
  }

  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/security')
  return { ok: true }
}
