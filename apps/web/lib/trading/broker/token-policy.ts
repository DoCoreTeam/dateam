/**
 * 접근토큰을 지금 어떻게 할 것인가 — 순수 판정
 *
 * ## 왜 순수 함수인가
 *
 * 규칙이 「만료 30분 전까지는 **어떤 실행도** 재발급을 안 부른다」인데, 이것은
 * 안 일어나는 일이라 눈으로 확인할 수 없다. 실제 DB 와 실제 KIS 를 붙여 두면
 * 「안 불렀다」를 시험할 방법이 없고, 못 시험하는 규칙은 지켜지는지 알 수 없다.
 *
 * ## 왜 이렇게까지 조심하나 (명세 §17.2 D-51)
 *
 * KIS 는 토큰 재발급을 **1분에 한 번**으로 막는다. 분마다 도는 크론이 저마다
 * 재발급을 부르면 첫 번째만 성공하고 나머지는 거부되며, 거부가 쌓이는 동안
 * **조회가 통째로 막힌다.** 매매 시스템에서 조회가 막힌 1분은 봉 하나가 통째로 비는 것이다.
 *
 * 그래서 순서를 정한다: 남으면 쓰고, 임박하면 **잠금을 잡은 하나만** 부르고,
 * 거부당했으면 아무도 이어서 안 부른다.
 */

export interface TokenRow {
  /** 암호화 봉투. 이 판정은 안을 안 본다 — 열어 볼 이유가 없다 */
  tokenEnc: unknown
  expiresAt: Date
  lockHolder: string | null
  lockedUntil: Date | null
}

export type TokenAction =
  /** 남았다. 있는 것을 쓴다 */
  | { kind: 'use' }
  /** 잠금을 잡고 재발급한다. 잡는 데 실패하면 부르는 쪽이 wait 로 다시 묻는다 */
  | { kind: 'reissue' }
  /** 남이 재발급 중이거나 직전에 거부당했다. 기다렸다가 다시 읽는다 */
  | { kind: 'wait'; reason: 'locked_by_other' | 'cooldown'; until: Date }
  /** 토큰이 아예 없고 잠금도 못 잡을 상황 — 부르는 쪽이 사유를 남긴다 */
  | { kind: 'issue_first' }

export interface TokenPolicyInput {
  row: TokenRow | null
  now: Date
  /** 만료 이만큼 전부터 재발급을 생각한다. 설정 `kis_token_refresh_margin_minutes` */
  refreshMarginMinutes: number
}

const MINUTE = 60_000

/**
 * @returns 지금 할 일 하나. 「재발급해도 되나」가 아니라 「무엇을 하나」를 답한다 —
 *          여러 갈래를 부르는 쪽이 다시 조립하면 그 조립이 두 벌이 된다
 */
export function decideTokenAction({ row, now, refreshMarginMinutes }: TokenPolicyInput): TokenAction {
  if (!row) return { kind: 'issue_first' }

  const marginMs = refreshMarginMinutes * MINUTE
  const remaining = row.expiresAt.getTime() - now.getTime()

  /**
   * 아직 넉넉하다. **잠금이 걸려 있든 말든** 그냥 쓴다 —
   * 남이 미리 재발급 중이어도 지금 토큰은 유효하므로 기다릴 이유가 없다.
   */
  if (remaining > marginMs) return { kind: 'use' }

  const lockedUntil = row.lockedUntil
  if (lockedUntil && lockedUntil.getTime() > now.getTime()) {
    /**
     * 잠금이 살아 있다. 두 경우가 섞여 있고 **둘 다 「내가 부르지 않는다」**이다.
     *   · 남이 재발급 중                → 곧 새 값이 온다
     *   · 직전 재발급이 거부당했다(EGW00133) → 1분 뒤 잠금을 잡은 하나가 다시 시도한다
     * 구분은 잠금을 건 쪽이 남긴 표시로 한다. 판정이 달라지지는 않고 사유만 달라진다.
     */
    const reason = row.lockHolder === COOLDOWN_HOLDER ? 'cooldown' : 'locked_by_other'
    return { kind: 'wait', reason, until: lockedUntil }
  }

  // 만료가 지났는데 토큰이 있는 경우도 여기로 온다 — 값이 있어도 못 쓰므로 재발급이다
  return { kind: 'reissue' }
}

/**
 * 재발급이 거부됐을 때 잠금 주인 자리에 적는 이름.
 *
 * 실행 ID 를 적으면 「그 실행이 아직 하고 있다」로 읽힌다. 거부는 다른 상태다 —
 * **아무도 하고 있지 않고, 그래도 지금은 아무도 시작하면 안 되는** 상태다.
 */
export const COOLDOWN_HOLDER = '__rate_limited__'

/** 거부당한 뒤 다음 시도까지. KIS 제한이 1분이라 그보다 살짝 길게 잡는다 */
export const COOLDOWN_MS = 65_000

/** 재발급 하나가 잡는 잠금의 길이. 실행이 죽어도 이만큼 뒤엔 남이 이어받는다 */
export const REISSUE_LOCK_MS = 30_000
