/**
 * 공개 API 관문의 판정 (P0158 I07)
 *
 * 경로 맞추기, 범위 판정(바로 실행 · 승인 요청 · 403), 서버 액션 인자 만들기, 멱등 요청 지문
 * DB 와 Next 를 모르는 순수 함수만 둔다, dispatch.test.ts 가 그대로 부른다
 */

import { createHash } from 'node:crypto'
import { APPROVAL_SCOPES, type Scope } from './types.ts'
import { effectiveScopes } from '../public-api/scopes.ts'

export interface MountLike {
  name: string
  scope: Scope
  kind: 'route' | 'action'
  method: string
  mount: string
  internal: string
  params: string[]
  exported: string
  module: number
}

/** 쓰기 분당 한도, 키 한도(분당 60)와 따로 센다 */
export const WRITE_LIMIT_PER_MINUTE = 20
export const PUBLIC_PREFIX = '/api/public/v1'
export const IDEMPOTENCY_KEY_MAX = 200

export interface Matched<T extends MountLike> {
  op: T
  params: Record<string, string>
}

function splitPath(p: string): string[] {
  return p.split('/').filter(Boolean)
}

/** 공개 경로(/api/public/v1 뒤)와 메서드로 정의를 찾는다, 글자 그대로인 칸이 많은 쪽이 이긴다 */
export function matchMount<T extends MountLike>(ops: readonly T[], method: string, path: string): Matched<T> | null {
  const segs = splitPath(path).map((s) => decodeURIComponent(s))
  let best: { m: Matched<T>; literal: number } | null = null
  for (const op of ops) {
    if (op.method !== method.toUpperCase()) continue
    const pat = splitPath(op.mount)
    if (pat.length !== segs.length) continue
    const params: Record<string, string> = {}
    let literal = 0
    let ok = true
    for (let i = 0; i < pat.length; i++) {
      const p = pat[i]
      const brace = /^\{(\w+)\}$/.exec(p)
      if (brace) {
        if (!segs[i]) { ok = false; break }
        params[brace[1]] = segs[i]
      } else if (p === segs[i]) {
        literal++
      } else {
        ok = false
        break
      }
    }
    if (ok && (!best || literal > best.literal)) best = { m: { op, params }, literal }
  }
  return best?.m ?? null
}

/** 내부 경로의 {id} 를 실제 값으로 */
export function internalPath(internal: string, params: Record<string, string>): string {
  return internal.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(params[k] ?? ''))
}

export type AccessDecision =
  | { kind: 'run' }
  | { kind: 'approval'; requiredScope: Scope }
  | { kind: 'forbidden'; requiredScope: Scope }

/**
 * 키 범위로 이 동작을 어떻게 할지
 * 범위가 있으면 실행, 없는데 승인 범위(approve send delete admin)이고 계정이 그 범위를 가질 수 있으면 승인 요청,
 * 그 밖(read write 가 없거나 계정이 못 가지는 범위)은 403
 */
export function decideAccess(opScope: Scope, keyScopes: readonly Scope[], role: string): AccessDecision {
  if (keyScopes.includes(opScope)) return { kind: 'run' }
  const accountMay = effectiveScopes(role, [opScope]).length > 0
  if (APPROVAL_SCOPES.includes(opScope) && accountMay) return { kind: 'approval', requiredScope: opScope }
  return { kind: 'forbidden', requiredScope: opScope }
}

export function isWrite(scope: Scope): boolean {
  return scope !== 'read'
}

/**
 * 서버 액션 인자
 * 몸통이 배열이면 그대로 펼치고, 객체면 정의의 매개변수 이름 순서로 꺼낸다
 * 매개변수가 하나인데 그 이름이 몸통에 없으면 몸통 전체를 그 하나로 넘긴다 (input 객체를 받는 액션)
 */
export function actionArgs(params: readonly string[], body: unknown): unknown[] {
  if (Array.isArray(body)) return body
  if (body === null || body === undefined) return []
  if (typeof body !== 'object') return [body]
  const obj = body as Record<string, unknown>
  if (params.length === 1 && !(params[0] in obj)) return [obj]
  return params.map((p) => obj[p])
}

/** 같은 Idempotency-Key 로 다른 요청을 보내면 거절하기 위한 지문 */
export function requestHash(method: string, path: string, body: string): string {
  return createHash('sha256').update(`${method.toUpperCase()} ${path}\n${body}`).digest('hex')
}

export function isDryRun(url: URL, headers: Headers): boolean {
  const q = url.searchParams.get('dryRun')
  return q === '1' || q === 'true' || headers.get('x-dry-run') === '1'
}

/** 공개 경로에서 접두사를 뗀다 */
export function publicPathOf(pathname: string): string {
  return pathname.startsWith(PUBLIC_PREFIX) ? pathname.slice(PUBLIC_PREFIX.length) || '/' : pathname
}
