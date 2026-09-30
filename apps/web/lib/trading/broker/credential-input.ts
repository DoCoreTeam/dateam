/**
 * 증권사 자격증명에 **무엇을 넣었나** — 판정만 하는 자리
 *
 * 사용자 지적 2026-09-30: 「수정좀 가능하게 해줄래? 키만 넣으면 수정이 안되네」.
 *
 * 저장 함수가 앱키와 시크릿을 **둘 다** 요구하고 있었다. 그런데 그 둘은 넣고 나면
 * 화면으로 다시 안 나온다 — 계좌번호 하나를 고치려고 보이지도 않는 값을 다시 적어야 했다.
 * 그건 고칠 수 없다는 뜻이다.
 *
 * 그리고 같은 날: 「-01 이 없어서 그런거 아냐?」.
 * 증권사 계좌는 `12345678-01` 처럼 여덟 자리 뒤에 상품코드 두 자리가 붙는다.
 * 지금 코드는 숫자가 아닌 글자를 다 지워 `1234567801` 열 자리를 통째로 계좌번호로 보냈다 —
 * 그러면 증권사는 그런 계좌가 없다고 답한다(실측 `APAC0071`).
 *
 * 판정을 여기 한 곳에 두는 이유: 화면도 서버도 같은 답을 봐야 한다.
 * 화면이 「저장 가능」이라 하고 서버가 거절하면 사람은 값이 틀렸다고 읽는다.
 */

export type CredentialIntent =
  /** 앱키·시크릿을 새로 넣는다 (계좌는 같이 넣을 수도 있다) */
  | { kind: 'full' }
  /** 이미 넣어 둔 줄에서 계좌번호만 바꾼다 */
  | { kind: 'account_only' }
  /** 아직 저장할 수 없다. 무엇이 빠졌는지 함께 말한다 */
  | { kind: 'blocked'; missing: readonly string[] }

export interface CredentialFields {
  appKey: string
  appSecret: string
  accountNo: string
  /** 이 환경에 이미 넣어 둔 것이 있나 */
  configured: boolean
}

/**
 * 이번에 무엇을 하려는 것인가.
 *
 * **반쪽 줄을 안 만든다** — 아직 아무것도 없는 환경에서 계좌번호만 저장하면
 * 앱키 없는 자격증명이 생기고, 그것으로는 증권사를 부를 수 없다.
 */
export function credentialIntent(f: CredentialFields): CredentialIntent {
  const appKey = f.appKey.trim()
  const appSecret = f.appSecret.trim()
  const accountNo = f.accountNo.trim()

  if (appKey !== '' && appSecret !== '') return { kind: 'full' }

  // 한쪽만 넣은 것은 언제나 막는다. 빈 쪽으로 덮으면 저장된 값이 사라진다
  if (appKey !== '' || appSecret !== '') {
    return {
      kind: 'blocked',
      missing: [appKey === '' ? '앱키' : null, appSecret === '' ? '앱시크릿' : null]
        .filter((w): w is string => w !== null),
    }
  }

  // 둘 다 비었다 — 이미 넣어 둔 줄이 있으면 계좌번호만 고치는 것이다
  if (f.configured && accountNo !== '') return { kind: 'account_only' }

  return { kind: 'blocked', missing: f.configured ? ['계좌번호'] : ['앱키', '앱시크릿'] }
}

export interface AccountParts {
  /** 종합계좌번호. 증권사가 `CANO` 로 받는 값 */
  cano: string
  /**
   * 계좌상품코드. 사람이 뒤 두 자리를 적었으면 그것이고,
   * 안 적었으면 null 이라 설정값(`kis_account_product_code`)이 쓰인다
   */
  productCode: string | null
}

/**
 * 적어 넣은 계좌번호를 증권사가 받는 두 조각으로.
 *
 * **모르는 모양은 안 고친다.** 여덟 자리도 열 자리도 아닌 값을 잘라 맞추면
 * 엉뚱한 계좌를 묻게 되고, 증권사는 「없다」고만 답하므로 무엇이 틀렸는지 알 길이 없다.
 */
export function splitAccountNo(raw: string): AccountParts | null {
  const digits = raw.replace(/\D/g, '')
  if (digits === '') return null
  /*
    **열 자리는 여덟 + 둘이다.** 증권사 계좌를 적을 때 쓰는 `12345678-01` 꼴이고,
    붙임표를 지우면 열 자리가 된다. 이 둘을 안 가르면 열 자리가 통째로 계좌번호가 된다
    (사용자 지적 2026-09-30 「-01 이 없어서 그런거 아냐?」).
  */
  if (digits.length === 10) return { cano: digits.slice(0, 8), productCode: digits.slice(8) }
  return { cano: digits, productCode: null }
}

/** 저장된 계좌가 어떤 모양인가 — **번호는 안 말하고 모양만 말한다**(S3) */
export interface AccountShape {
  /** 자릿수 */
  digits: number
  /** 뒤 두 자리를 같이 넣었나 */
  hasProductCode: boolean
}

/**
 * 가린 번호에서 모양을 읽는다. `maskAccountNo` 는 앞을 별표로 덮고 뒤 넷만 남기므로
 * **글자 수가 곧 자릿수**다 — 번호를 열어 보지 않고도 여덟 자리인지 열 자리인지 안다.
 */
export function accountShapeFromMask(mask: string | null): AccountShape | null {
  if (!mask) return null
  const digits = mask.trim().length
  if (digits < 4) return null
  return { digits, hasProductCode: digits >= 10 }
}
