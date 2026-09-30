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
import { credentialIntent, splitAccountNo } from './credential-input.ts'

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
  const accountNo = (input.accountNo ?? '').trim()

  /*
    **계좌번호만 고치는 길이 있어야 한다** (사용자 지적 2026-09-30 「수정좀 가능하게
    해줄래? 키만 넣으면 수정이 안되네」). 앱키와 시크릿은 넣고 나면 화면으로 다시 안 나오는데,
    저장이 그 둘을 늘 요구하면 계좌번호 하나를 고치려고 보이지도 않는 값을 다시 적어야 한다.
    그건 고칠 수 없다는 뜻이다.

    판정은 `credentialIntent` 하나가 한다 — 화면이 「저장 가능」이라 하고 서버가 거절하면
    사람은 값이 틀렸다고 읽는다.
  */
  const configured = (await getTradingCredentialStatus(input.env)).configured
  const intent = credentialIntent({ appKey, appSecret, accountNo, configured })
  if (intent.kind === 'blocked') {
    return {
      ok: false,
      reason: 'empty_credential',
      userMessage: `${intent.missing.join('과 ')}을 입력해 주세요`,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  if (intent.kind === 'account_only') {
    /*
      **비밀 칸은 손대지 않는다.** 빈 값으로 덮으면 저장해 둔 앱키가 사라지고,
      그때부터 증권사를 아예 못 부른다 — 그리고 그 값은 다시 넣을 수도 없다
    */
    const { error: patchError } = await admin
      .from('trading_broker_credentials')
      .update({
        account_no_enc: sealTradingSecret(accountNo),
        account_mask: maskAccountNo(accountNo),
        updated_at: new Date().toISOString(),
        updated_by: input.updatedBy ?? null,
      })
      .eq('env', input.env)
    if (patchError) {
      return { ok: false, reason: `write_failed:${patchError.message}`, userMessage: '계좌번호를 저장하지 못했습니다' }
    }
    return { ok: true }
  }

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
  /*
    **뒤 두 자리를 살린다** (사용자 지적 2026-09-30 「-01 이 없어서 그런거 아냐?」).
    증권사 계좌는 `12345678-01` 처럼 여덟 자리 뒤에 상품코드 두 자리가 붙는다.
    전에는 숫자가 아닌 글자를 다 지워 열 자리를 통째로 계좌번호로 보냈고,
    그러면 증권사는 그런 계좌가 없다고 답한다(실측 `APAC0071`).
    사람이 안 적었으면 설정값(`kis_account_product_code`)이 그대로 쓰인다.
  */
  const parts = splitAccountNo(openTradingSecret(data.account_no_enc))
  if (!parts) return null
  return { cano: parts.cano, acntPrdtCd: parts.productCode ?? acntPrdtCd }
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
