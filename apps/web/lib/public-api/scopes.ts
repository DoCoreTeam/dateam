/**
 * 공개 API 키 범위와 만료 판정 (P0158 I04)
 *
 * 실제 권한 = 계정 권한 ∩ 키 범위
 *   계정 권한은 profiles.role 이 정하고(관리자만 admin), 키 범위는 키를 만들 때 고른다
 *   어느 한쪽만 넓어서는 아무것도 더 할 수 없다
 *
 * 범위를 정하지 않은 창구는 메서드로 정한다, GET HEAD 는 read, DELETE 는 delete, 그 밖은 write
 *   범위를 빼먹은 새 쓰기 창구가 read 키로 열리지 않게 기본값이 닫힌 쪽이다
 *
 * DB 와 Next 를 모르는 순수 함수만 둔다, 시험이 그대로 부른다
 */

import type { Scope } from '../actions/types.ts'

export type { Scope }

export const ALL_SCOPES: readonly Scope[] = ['read', 'write', 'approve', 'send', 'delete', 'admin']

/** 계정 역할이 가질 수 있는 범위, 키 범위는 이 안에서만 효력이 있다 */
const ROLE_SCOPES: Record<string, readonly Scope[]> = {
  admin: ALL_SCOPES,
  member: ['read', 'write', 'approve', 'send', 'delete'],
  api_user: ['read', 'write'],
}

/** 마이그레이션 318 전 키와 칼럼이 아직 없는 DB 는 read 만 (마이그레이션의 기본값과 같다) */
export const LEGACY_SCOPES: readonly Scope[] = ['read']

export function isScope(v: unknown): v is Scope {
  return typeof v === 'string' && (ALL_SCOPES as readonly string[]).includes(v)
}

/** DB 값을 범위 목록으로, 모르는 값은 버리고 비면 read */
export function parseScopes(raw: unknown): Scope[] {
  const list = Array.isArray(raw) ? raw.filter(isScope) : []
  return list.length > 0 ? [...new Set(list)] : [...LEGACY_SCOPES]
}

/** 계정 권한 ∩ 키 범위 */
export function effectiveScopes(role: string, keyScopes: readonly Scope[]): Scope[] {
  const allowed = ROLE_SCOPES[role] ?? LEGACY_SCOPES
  return keyScopes.filter((s) => allowed.includes(s))
}

/** 창구가 범위를 안 정했을 때의 기본값 */
export function scopeForMethod(method: string): Scope {
  const m = method.toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return 'read'
  return m === 'DELETE' ? 'delete' : 'write'
}

export function isExpired(expiresAt: string | null | undefined, now: Date): boolean {
  if (!expiresAt) return false
  const t = new Date(expiresAt).getTime()
  return Number.isFinite(t) && t <= now.getTime()
}

export type KeyAccess =
  | { ok: true; scopes: Scope[] }
  | { ok: false; status: 403; code: 'expired' | 'scope'; requiredScope?: Scope }

/**
 * 키 하나가 이 요청을 할 수 있는가
 * 만료를 범위보다 먼저 본다, 만료된 키에는 어떤 범위가 필요한지도 알려 주지 않는다
 */
export function decideKeyAccess(input: {
  role: string
  scopes: unknown
  expiresAt: string | null | undefined
  required: Scope
  now: Date
}): KeyAccess {
  if (isExpired(input.expiresAt, input.now)) return { ok: false, status: 403, code: 'expired' }
  const scopes = effectiveScopes(input.role, parseScopes(input.scopes))
  if (!scopes.includes(input.required)) {
    return { ok: false, status: 403, code: 'scope', requiredScope: input.required }
  }
  return { ok: true, scopes }
}
