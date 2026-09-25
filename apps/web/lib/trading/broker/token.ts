import 'server-only'

/**
 * KIS 접근토큰 — **DB 한 행이 유일한 자리다** (명세 §17.2 D-51)
 *
 * ## 왜 캐시를 메모리에 안 두나
 *
 * Vercel 은 인스턴스를 여러 개 띄운다. 모듈 변수에 토큰을 들면 인스턴스마다 다른 값이 되고,
 * 저마다 만료를 판단해 저마다 재발급을 부른다. KIS 는 재발급을 **1분에 한 번**으로 막으므로
 * 첫 번째만 성공하고 나머지는 거부되며, 거부가 쌓이는 동안 **조회가 통째로 막힌다.**
 * 매매에서 조회가 막힌 1분은 봉 하나가 통째로 비는 것이다.
 *
 * 그래서 값도 잠금도 DB 한 행에 있다. 상시 워커는 필요 없다 — 분마다 도는 실행 중
 * 잠금을 잡은 **하나만** 재발급하고, 나머지는 기다렸다 새 값을 읽는다.
 *
 * 판정 자체는 `token-policy.ts` 에 있다. 여기는 DB 와 KIS 를 대는 자리다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { sealTradingSecret, openTradingSecret } from './crypto.ts'
import { loadAppCredential } from './credentials.ts'
import {
  kisHost,
  KIS_TOKEN_PATH,
  KIS_TOKEN_RATE_LIMIT_CODE,
  type KisEnv,
} from './endpoints.ts'
import {
  decideTokenAction,
  COOLDOWN_HOLDER,
  COOLDOWN_MS,
  REISSUE_LOCK_MS,
  type TokenRow,
} from './token-policy.ts'

export interface AccessTokenOk {
  ok: true
  accessToken: string
  expiresAt: Date
}

export interface AccessTokenFail {
  ok: false
  /** 기계가 읽는 사유. 조용히 빈 값을 돌려주지 않는다 */
  reason: string
  /** 사람이 읽을 문장 */
  userMessage: string
  /** 언제 다시 해 볼 만한가. 기다리면 되는 상황과 손대야 하는 상황을 가른다 */
  retryAfter?: Date
}

export type AccessTokenResult = AccessTokenOk | AccessTokenFail

interface TokenTableRow {
  token_enc: unknown
  issued_at: string
  expires_at: string
  lock_holder: string | null
  locked_until: string | null
}

function toPolicyRow(row: TokenTableRow | null): TokenRow | null {
  if (!row) return null
  return {
    tokenEnc: row.token_enc,
    expiresAt: new Date(row.expires_at),
    lockHolder: row.lock_holder,
    lockedUntil: row.locked_until ? new Date(row.locked_until) : null,
  }
}

async function readRow(env: KisEnv): Promise<TokenTableRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_broker_tokens')
    .select('token_enc, issued_at, expires_at, lock_holder, locked_until')
    .eq('env', env)
    .maybeSingle()
  if (error) throw new Error(`토큰을 읽지 못했습니다: ${error.message}`)
  return (data ?? null) as TokenTableRow | null
}

/**
 * 잠금을 잡는다 — **잡은 실행만** KIS 를 부른다.
 *
 * 조건절에 잠금 상태를 넣어 DB 가 판정하게 한다. 읽고 나서 코드가 판단하면
 * 그 사이에 남이 잡을 수 있고, 둘 다 「내가 잡았다」고 믿는다.
 */
async function claimLock(env: KisEnv, holder: string, now: Date): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_broker_tokens')
    .update({ lock_holder: holder, locked_until: new Date(now.getTime() + REISSUE_LOCK_MS).toISOString() })
    .eq('env', env)
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
    .select('env')
  if (error) throw new Error(`토큰 잠금을 잡지 못했습니다: ${error.message}`)
  return (data ?? []).length > 0
}

/** 거부당했다고 적는다. 실행 ID 가 아니라 전용 이름을 적어 「하는 중」과 구분한다 */
async function markCooldown(env: KisEnv, now: Date): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  await admin
    .from('trading_broker_tokens')
    .update({ lock_holder: COOLDOWN_HOLDER, locked_until: new Date(now.getTime() + COOLDOWN_MS).toISOString() })
    .eq('env', env)
}

interface IssuedToken {
  accessToken: string
  expiresAt: Date
}

interface IssueFail {
  reason: string
  rateLimited: boolean
}

/**
 * KIS 에 토큰을 달라고 한다.
 *
 * 주소는 상수 호스트 + 상수 경로다. 바깥 값이 주소에 끼어들 자리가 없다(보안 S4).
 */
async function issueToken(env: KisEnv): Promise<IssuedToken | IssueFail> {
  const credential = await loadAppCredential(env)
  if (!credential) return { reason: 'no_credential', rateLimited: false }

  const response = await fetch(`${kisHost(env)}${KIS_TOKEN_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: credential.appKey,
      appsecret: credential.appSecret,
    }),
  })

  const body = (await response.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; access_token_token_expired?: string; error_code?: string; error_description?: string }
    | null

  if (!response.ok || !body?.access_token) {
    const code = body?.error_code ?? String(response.status)
    return {
      // 오류 문장에 내부 구조를 싣지 않는다 — 코드와 상태만 남긴다
      reason: `issue_failed:${code}`,
      rateLimited: code === KIS_TOKEN_RATE_LIMIT_CODE,
    }
  }

  /**
   * 만료는 KIS 가 주는 값을 쓴다. 우리가 24시간으로 가정하면 그쪽이 짧게 주는 날
   * 이미 죽은 토큰으로 조회하다가 하루 종일 실패한다.
   */
  const expiresInSec = typeof body.expires_in === 'number' ? body.expires_in : 60 * 60 * 24
  return { accessToken: body.access_token, expiresAt: new Date(Date.now() + expiresInSec * 1000) }
}

async function saveToken(env: KisEnv, issued: IssuedToken, now: Date): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_broker_tokens').upsert({
    env,
    token_enc: sealTradingSecret(issued.accessToken),
    issued_at: now.toISOString(),
    expires_at: issued.expiresAt.toISOString(),
    // 저장과 동시에 잠금을 푼다. 푸는 것을 잊으면 다음 재발급이 30초 늦는다
    lock_holder: null,
    locked_until: null,
    updated_at: now.toISOString(),
  }, { onConflict: 'env' })
  if (error) throw new Error(`토큰을 저장하지 못했습니다: ${error.message}`)
}

/** 첫 발급 때 행이 없어 잠금을 걸 대상이 없다. 빈 행을 먼저 세운다 */
async function ensureRow(env: KisEnv, now: Date): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  await admin.from('trading_broker_tokens').insert({
    env,
    token_enc: sealTradingSecret(''),
    issued_at: now.toISOString(),
    // 이미 만료된 것으로 세운다 — 값이 빈 토큰을 유효한 것으로 읽으면 안 된다
    expires_at: now.toISOString(),
    lock_holder: null,
    locked_until: null,
  })
  // 유일 키(env)에 걸려 실패하면 남이 먼저 세운 것이다. 그것으로 충분하다
}

export interface GetAccessTokenOptions {
  env: KisEnv
  /** 설정 `kis_token_refresh_margin_minutes` */
  refreshMarginMinutes: number
  /** 이 실행의 이름. 잠금 주인 자리에 적힌다 */
  runId: string
  now?: Date
}

/**
 * 지금 쓸 접근토큰.
 *
 * **여유가 있으면 KIS 를 부르지 않는다.** 이 함수가 조회 경로의 유일한 토큰 입구다.
 */
export async function getAccessToken(options: GetAccessTokenOptions): Promise<AccessTokenResult> {
  const now = options.now ?? new Date()
  const { env, refreshMarginMinutes, runId } = options

  const stored = await readRow(env)
  const action = decideTokenAction({
    row: toPolicyRow(stored),
    now,
    refreshMarginMinutes,
  })

  if (action.kind === 'use' && stored) {
    return { ok: true, accessToken: openTradingSecret(stored.token_enc), expiresAt: new Date(stored.expires_at) }
  }

  if (action.kind === 'wait') {
    return {
      ok: false,
      reason: `token_${action.reason}`,
      userMessage:
        action.reason === 'cooldown'
          ? '증권사 토큰 재발급이 잠시 제한돼 있습니다. 1분 뒤 자동으로 다시 시도합니다'
          : '증권사 토큰을 재발급하는 중입니다. 잠시 뒤 자동으로 다시 시도합니다',
      retryAfter: action.until,
    }
  }

  if (action.kind === 'issue_first') await ensureRow(env, now)

  const claimed = await claimLock(env, runId, now)
  if (!claimed) {
    // 방금 남이 잡았다. 이 실행은 부르지 않는다 — 둘이 부르면 하나는 반드시 거부당한다
    return {
      ok: false,
      reason: 'token_locked_by_other',
      userMessage: '증권사 토큰을 재발급하는 중입니다. 잠시 뒤 자동으로 다시 시도합니다',
      retryAfter: new Date(now.getTime() + REISSUE_LOCK_MS),
    }
  }

  const issued = await issueToken(env)
  if ('reason' in issued) {
    if (issued.rateLimited) await markCooldown(env, now)
    return {
      ok: false,
      reason: issued.reason,
      userMessage:
        issued.reason === 'no_credential'
          ? '증권사 앱키가 아직 등록되지 않았습니다'
          : '증권사 토큰을 발급받지 못했습니다',
      ...(issued.rateLimited ? { retryAfter: new Date(now.getTime() + COOLDOWN_MS) } : {}),
    }
  }

  await saveToken(env, issued, now)
  return { ok: true, accessToken: issued.accessToken, expiresAt: issued.expiresAt }
}
