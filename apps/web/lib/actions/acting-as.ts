/**
 * 키 소유자의 세션 만들기 (P0158 I06)
 *
 * 처리 함수는 RLS 를 지나는 사용자 세션을 기대한다, 서비스롤로 부르면 RLS 를 통째로 건너뛴다
 * 그래서 키 소유자 본인의 세션을 만든다
 *   서비스롤 generateLink(magiclink) 로 일회용 토큰 해시를 받고 (메일은 안 나감)
 *   익명 키 verifyOtp 로 그 사람 세션을 받는다
 * 사용자별로 메모리에 두고 만료 2분 전까지 다시 쓴다, 토큰 값은 어디에도 찍지 않는다
 *
 * DB 를 모르는 시험이 그대로 부르도록 클라이언트는 밖에서 넣는다 (acting-as.test.ts)
 */

import type { ActingSession } from './acting-session.ts'

export interface SessionMinterDeps {
  generateLink: (email: string) => Promise<{ tokenHash: string | null; error: string | null }>
  verifyOtp: (tokenHash: string) => Promise<{ session: ActingSession | null; error: string | null }>
  emailOf: (userId: string) => Promise<string | null>
  now?: () => number
}

/** 만료까지 이만큼 남으면 새로 만든다 */
export const SESSION_REFRESH_MARGIN_SEC = 120

export type MintResult = { ok: true; session: ActingSession } | { ok: false; reason: 'no_user' | 'link_failed' | 'verify_failed' }

export function createSessionMinter(deps: SessionMinterDeps) {
  const cache = new Map<string, ActingSession>()
  const inflight = new Map<string, Promise<MintResult>>()
  const nowSec = () => Math.floor((deps.now ? deps.now() : Date.now()) / 1000)

  async function mint(userId: string): Promise<MintResult> {
    const email = await deps.emailOf(userId)
    if (!email) return { ok: false, reason: 'no_user' }
    const link = await deps.generateLink(email)
    if (link.error || !link.tokenHash) return { ok: false, reason: 'link_failed' }
    const verified = await deps.verifyOtp(link.tokenHash)
    if (verified.error || !verified.session) return { ok: false, reason: 'verify_failed' }
    cache.set(userId, verified.session)
    return { ok: true, session: verified.session }
  }

  return {
    async sessionFor(userId: string): Promise<MintResult> {
      const hit = cache.get(userId)
      if (hit && hit.expiresAt - nowSec() > SESSION_REFRESH_MARGIN_SEC) return { ok: true, session: hit }
      const running = inflight.get(userId)
      if (running) return running
      const p = mint(userId).finally(() => inflight.delete(userId))
      inflight.set(userId, p)
      return p
    },
    /** 키를 폐기하거나 사용자가 막히면 비운다 */
    forget(userId: string) {
      cache.delete(userId)
    },
    size: () => cache.size,
  }
}
