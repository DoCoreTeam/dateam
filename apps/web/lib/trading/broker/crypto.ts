import 'server-only'

/**
 * KIS 비밀값 봉투 — **암호는 새로 안 짠다**
 *
 * ## 왜 감싸기만 하나
 *
 * 이 저장소에는 이미 AES-256-GCM 봉투가 있다(`lib/ci/settings/crypto.ts`).
 * 같은 알고리즘을 한 벌 더 쓰면 마스터 키가 둘이 되고, 둘 중 하나만 회전시키는 날이 온다.
 * 명세 §17.1 도 「먼저 찾고, 없으면 기본 구현」이라고 적는다 — 찾았으므로 그것을 쓴다.
 *
 * 찾아본 것과 결론 (`docs/trading/ASSUMPTIONS.md` 에도 한 줄로 남긴다):
 *   · `ai_provider_keys.api_key` — **평문**이다(마이그 264). RLS 와 서비스롤로만 막는다.
 *     본뜰 암호화 헬퍼가 그쪽에는 없다
 *   · `lib/ci/settings/crypto.ts` — AES-256-GCM 봉투 + `CI_SETTINGS_MASTER_KEY`. 이것을 쓴다
 *   · 그래서 **새 환경변수를 만들지 않는다**. `TRADING_ENCRYPTION_KEY` 는 안 쓴다
 *
 * ## 왜 이름을 다시 붙이나
 *
 * 저쪽 오류 문장은 「설정 암호화 마스터 키」를 말한다. 트레이딩 설정 화면에서 그 문장이
 * 그대로 뜨면 관리자는 다른 기능 이야기로 읽는다. 그래서 사유는 그대로 두고
 * **사람이 읽을 문장만** 이 자리에서 바꾼다.
 */

import {
  encryptSecret,
  decryptSecret,
  isMasterKeyAvailable,
  isSecretEnvelope,
  type SecretEnvelope,
} from '@/lib/ci/settings/crypto'

export type { SecretEnvelope }
export { isSecretEnvelope }

/** 암호화가 가능한 상태인가. 저장 화면이 미리 물어 「저장 눌렀더니 실패」를 없앤다 */
export function canSealTradingSecret(): boolean {
  return isMasterKeyAvailable()
}

export class TradingSecretKeyUnavailableError extends Error {
  readonly code = 'TRADING_SECRET_KEY_UNAVAILABLE'
  readonly userMessage = '암호화 키가 설정되지 않아 증권사 자격증명을 저장할 수 없습니다'
  constructor() {
    super('설정 암호화 마스터 키가 없어 트레이딩 비밀값을 다룰 수 없습니다')
    this.name = 'TradingSecretKeyUnavailableError'
  }
}

/**
 * 평문을 봉투에 넣는다.
 *
 * **평문 폴백이 없다.** 키가 없으면 던진다 — 조용히 평문으로 저장되는 것이
 * 비밀 유출의 전형적인 경로다(저쪽 모듈이 같은 이유로 같은 규율을 쓴다).
 */
export function sealTradingSecret(plaintext: string): SecretEnvelope {
  if (!isMasterKeyAvailable()) throw new TradingSecretKeyUnavailableError()
  return encryptSecret(plaintext)
}

export function openTradingSecret(envelope: unknown): string {
  if (!isMasterKeyAvailable()) throw new TradingSecretKeyUnavailableError()
  if (!isSecretEnvelope(envelope)) {
    // 봉투가 아닌 것이 칼럼에 들어 있으면 그것은 평문일 수 있다. 읽어서 쓰지 않는다
    throw new Error('암호화 봉투가 아닌 값이 저장돼 있습니다')
  }
  return decryptSecret(envelope)
}

/**
 * 계좌번호를 가린 꼴로. 복호화 없이 「어느 계좌인가」를 말할 수 있어야
 * 화면이 계좌를 확인하려고 비밀을 열지 않는다.
 */
export function maskAccountNo(accountNo: string): string {
  const digits = accountNo.replace(/\D/g, '')
  if (digits.length <= 4) return '****'
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`
}
