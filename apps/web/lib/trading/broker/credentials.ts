import 'server-only'

/**
 * KIS 자격증명 — **넣는 길만 있고 보는 길은 없다**
 *
 * 앱키·시크릿은 저장한 뒤 화면으로 다시 나오지 않는다. 「확인용으로 한 번만」을 만들면
 * 그 길이 곧 유출 경로가 된다. 어느 계좌인지는 가린 번호(`account_mask`)가 말한다 —
 * 그러라고 복호화 없이 읽을 수 있는 칼럼을 따로 뒀다.
 *
 * 조회 전용 앱키다(M1). 이 저장소에 주문을 부르는 코드는 없다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { sealTradingSecret, openTradingSecret, maskAccountNo, canSealTradingSecret } from './crypto.ts'
import type { KisEnv } from './endpoints.ts'

export interface TradingCredentialInput {
  env: KisEnv
  appKey: string
  appSecret: string
  /** 계좌번호는 1-A 에서 안 쓴다(계좌 조회는 1-C). 미리 넣어 둘 수는 있다 */
  accountNo?: string
  updatedBy?: string | null
}

export interface TradingCredentialStatus {
  env: KisEnv
  /** 넣어 두었나. 값 자체는 안 준다 */
  configured: boolean
  accountMask: string | null
  updatedAt: string | null
}

export type SaveCredentialResult =
  | { ok: true }
  | { ok: false; reason: string; userMessage: string }

export async function saveTradingCredentials(
  input: TradingCredentialInput,
): Promise<SaveCredentialResult> {
  if (!canSealTradingSecret()) {
    return {
      ok: false,
      reason: 'encryption_unavailable',
      userMessage: '암호화 키가 설정되지 않아 증권사 자격증명을 저장할 수 없습니다',
    }
  }
  const appKey = input.appKey.trim()
  const appSecret = input.appSecret.trim()
  if (appKey === '' || appSecret === '') {
    return { ok: false, reason: 'empty_credential', userMessage: '앱키와 앱시크릿을 모두 입력해 주세요' }
  }

  const accountNo = (input.accountNo ?? '').trim()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_broker_credentials').upsert({
    env: input.env,
    appkey_enc: sealTradingSecret(appKey),
    appsecret_enc: sealTradingSecret(appSecret),
    account_no_enc: accountNo === '' ? null : sealTradingSecret(accountNo),
    account_mask: accountNo === '' ? null : maskAccountNo(accountNo),
    updated_at: new Date().toISOString(),
    updated_by: input.updatedBy ?? null,
  }, { onConflict: 'env' })

  // supabase-js 는 쓰기 오류를 던지지 않고 돌려준다. 안 보면 0건 저장이 성공으로 보인다
  if (error) {
    return { ok: false, reason: `write_failed:${error.message}`, userMessage: '자격증명을 저장하지 못했습니다' }
  }
  return { ok: true }
}

/** 화면이 묻는 것 — 넣었나, 어느 계좌인가. 비밀은 안 나온다 */
export async function getTradingCredentialStatus(env: KisEnv): Promise<TradingCredentialStatus> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_broker_credentials')
    .select('env, account_mask, updated_at')
    .eq('env', env)
    .maybeSingle()
  if (error) throw new Error(`자격증명 상태를 읽지 못했습니다: ${error.message}`)
  return {
    env,
    configured: Boolean(data),
    accountMask: data?.account_mask ?? null,
    updatedAt: data?.updated_at ?? null,
  }
}

export interface DecryptedAppCredential {
  appKey: string
  appSecret: string
}

/**
 * 계좌 번호 — **조회에만 쓴다.**
 *
 * 앱키와 따로 여는 이유: 계좌 조회는 계좌번호가 필요하고 분봉 조회는 안 필요하다.
 * 한 함수가 둘 다 열면 필요 없는 자리에도 계좌번호가 흘러 들어간다.
 * 화면과 로그로 나갈 때는 `maskAccountNo` 를 지난다(S3).
 */
export interface DecryptedAccountRef {
  cano: string
  acntPrdtCd: string
}

/**
 * @param acntPrdtCd 계좌상품코드. 비밀이 아니라 설정이다(`kis_account_product_code`)
 */
export async function loadAccountRef(
  env: KisEnv, acntPrdtCd: string,
): Promise<DecryptedAccountRef | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_broker_credentials')
    .select('account_no_enc')
    .eq('env', env)
    .maybeSingle()
  if (error) throw new Error(`계좌 번호를 읽지 못했습니다: ${error.message}`)
  if (!data || !data.account_no_enc) return null
  const cano = openTradingSecret(data.account_no_enc).replace(/\D/g, '')
  if (cano === '') return null
  return { cano, acntPrdtCd }
}

/**
 * 서버가 KIS 를 부를 때만 연다.
 *
 * 화면이나 창구가 이 값을 받아 가는 길은 만들지 않는다 — 부르는 곳은
 * 토큰 발급(`token.ts`)과 조회 클라이언트(`kis-client.ts`)뿐이다.
 */
export async function loadAppCredential(env: KisEnv): Promise<DecryptedAppCredential | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_broker_credentials')
    .select('appkey_enc, appsecret_enc')
    .eq('env', env)
    .maybeSingle()
  if (error) throw new Error(`자격증명을 읽지 못했습니다: ${error.message}`)
  if (!data) return null
  return {
    appKey: openTradingSecret(data.appkey_enc),
    appSecret: openTradingSecret(data.appsecret_enc),
  }
}
