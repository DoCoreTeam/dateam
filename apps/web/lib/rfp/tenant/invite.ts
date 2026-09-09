/**
 * 초대 (설계서 F12)
 *
 * ## 초대 링크가 영원하면 안 된다
 *
 * 메일은 전달되고 캡처되고 남는다. 기한이 없는 링크는 **1년 뒤에도 남의 조직에 들어가는 문**이다.
 *
 * ## 이미 들어온 사람을 다시 초대하지 않는다
 *
 * 초대장이 둘이면 어느 쪽을 눌렀는지에 따라 역할이 달라진다.
 */

import type { OrgRole } from './org.ts'

/** 초대 유효 기간 */
export const INVITE_TTL_DAYS = 7
/** 토큰 길이 — 짧으면 찍어 맞힐 수 있다 */
export const TOKEN_BYTES = 32

export interface Invite {
  orgId: string
  email: string
  role: OrgRole
  token: string
  expiresAt: string
  acceptedAt: string | null
}

export type InviteProblem = 'bad_email' | 'already_member' | 'already_invited' | 'bad_role'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export interface InviteContext {
  members: readonly { email: string }[]
  pending: readonly { email: string; acceptedAt: string | null }[]
}

/** 초대할 수 있나 */
export function validateInvite(
  input: { email?: unknown; role?: unknown },
  ctx: InviteContext,
): { email: string; role: OrgRole; problems: InviteProblem[] } {
  const problems: InviteProblem[] = []
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email)) problems.push('bad_email')

  const role = String(input.role ?? 'member')
  if (!['admin', 'member', 'viewer'].includes(role)) problems.push('bad_role')

  if (email && ctx.members.some((m) => m.email.toLowerCase() === email)) {
    problems.push('already_member')
  }
  // 초대장이 둘이면 어느 쪽을 눌렀는지에 따라 역할이 달라진다
  if (email && ctx.pending.some((p) => p.email.toLowerCase() === email && p.acceptedAt === null)) {
    problems.push('already_invited')
  }

  return { email, role: (problems.includes('bad_role') ? 'member' : role) as OrgRole, problems }
}

/** 초대 토큰 — 추측할 수 없어야 한다 */
export async function makeToken(): Promise<string> {
  const { randomBytes } = await import('node:crypto')
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

export function expiryFrom(now: number, days = INVITE_TTL_DAYS): string {
  return new Date(now + days * 86_400_000).toISOString()
}

export type AcceptResult =
  | { ok: true; orgId: string; role: OrgRole }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_accepted' }

/**
 * 초대를 받는다.
 *
 * 만료와 재사용을 **둘 다** 막는다 — 한 번 쓴 초대장으로 두 번 들어오면
 * 나간 사람이 다시 들어온다.
 */
export function acceptInvite(invite: Invite | null, now: number): AcceptResult {
  if (!invite) return { ok: false, reason: 'not_found' }
  if (invite.acceptedAt) return { ok: false, reason: 'already_accepted' }
  if (Date.parse(invite.expiresAt) <= now) return { ok: false, reason: 'expired' }
  return { ok: true, orgId: invite.orgId, role: invite.role }
}
