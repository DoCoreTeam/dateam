/**
 * 키 소유자로 처리 중이라는 문맥 (P0158 I06)
 *
 * 공개 API 관문이 키를 확인한 뒤 이 문맥을 열고, 그 안에서 화면이 쓰는 처리 함수를 그대로 부른다
 * 처리 함수 안의 createClient 는 쿠키 대신 이 문맥의 세션을 쓴다 (lib/supabase/server.ts)
 *
 * 문맥을 여는 길은 하나다, issueActingGrant 가 만든 허가증으로만 runActing 이 열린다
 *   허가증은 이 모듈의 WeakSet 에 등록된 객체만 통과한다, 같은 모양으로 만든 객체는 거절된다
 *   issueActingGrant 와 runActing 을 부를 수 있는 파일은 acting-as.test.ts 가 센다 (관문과 이 모듈뿐)
 * 문맥 밖에서는 currentActing() 이 undefined 이고 createClient 는 지금과 똑같다
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Scope } from './types.ts'

export interface ActingSession {
  accessToken: string
  refreshToken: string
  /** epoch 초 */
  expiresAt: number
}

export interface ActingContext {
  userId: string
  role: string
  keyId: string
  scopes: readonly Scope[]
  /** 요청 추적 id, 감사 기록과 응답 헤더에 같이 실림 */
  requestId: string
  session: ActingSession
}

export interface ActingGrant {
  readonly ctx: ActingContext
}

const store = new AsyncLocalStorage<ActingContext>()
const issued = new WeakSet<object>()

/** 키 확인을 마친 관문만 부른다, 확인 전 값으로 부르면 그 사람 권한이 열린다 */
export function issueActingGrant(ctx: ActingContext): ActingGrant {
  if (!ctx.userId || !ctx.keyId || !ctx.session?.accessToken) {
    throw new Error('acting grant needs a verified key owner and session')
  }
  const grant = Object.freeze({ ctx: Object.freeze({ ...ctx, scopes: Object.freeze([...ctx.scopes]) }) })
  issued.add(grant)
  return grant
}

/** 허가증이 있을 때만 문맥을 연다 */
export function runActing<T>(grant: ActingGrant, fn: () => T): T {
  if (!grant || !issued.has(grant)) throw new Error('acting scope refused: grant not issued by the gateway')
  return store.run(grant.ctx, fn)
}

/** 지금 키 소유자로 처리 중이면 그 문맥, 아니면 undefined */
export function currentActing(): ActingContext | undefined {
  return store.getStore()
}
