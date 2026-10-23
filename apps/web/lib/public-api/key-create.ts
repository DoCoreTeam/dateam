/**
 * API 키 만들기 입력 검증 (P0158 I05)
 *
 * 범위는 알려진 여섯 값만, 계정 역할이 가질 수 없는 범위는 거절한다
 *   (교집합으로 어차피 효력이 없지만 화면에 「admin」 키가 있다고 보이면 사람이 속는다)
 * 만료는 1일에서 365일, 안 주면 90일
 */

import { z } from 'zod'
import { ALL_SCOPES, effectiveScopes, type Scope } from './scopes.ts'

export const KEY_EXPIRY_MAX_DAYS = 365
export const KEY_EXPIRY_DEFAULT_DAYS = 90
const DAY_MS = 86_400_000

export const keyCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  purpose: z.string().trim().max(200).optional(),
  scopes: z.array(z.enum(ALL_SCOPES as [Scope, ...Scope[]])).min(1).default(['read']),
  expiresInDays: z.number().int().min(1).max(KEY_EXPIRY_MAX_DAYS).default(KEY_EXPIRY_DEFAULT_DAYS),
})

export type KeyCreateInput = z.infer<typeof keyCreateSchema>

export type KeyCreateResult =
  | { ok: true; row: { name: string; purpose: string | null; scopes: Scope[]; expires_at: string } }
  | { ok: false; status: 400 | 403; error: string; scopes?: Scope[] }

/** 요청 몸통과 계정 역할로 넣을 줄을 만든다 */
export function prepareKeyCreate(body: unknown, role: string, now: Date): KeyCreateResult {
  const parsed = keyCreateSchema.safeParse(body)
  if (!parsed.success) return { ok: false, status: 400, error: 'invalid_request' }
  const scopes = [...new Set(parsed.data.scopes)]
  const allowed = effectiveScopes(role, scopes)
  const denied = scopes.filter((s) => !allowed.includes(s))
  if (denied.length > 0) return { ok: false, status: 403, error: 'scope_not_allowed', scopes: denied }
  return {
    ok: true,
    row: {
      name: parsed.data.name,
      purpose: parsed.data.purpose ? parsed.data.purpose : null,
      scopes,
      expires_at: new Date(now.getTime() + parsed.data.expiresInDays * DAY_MS).toISOString(),
    },
  }
}
