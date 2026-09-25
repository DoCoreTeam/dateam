/**
 * 트레이딩 모듈에 들어갈 수 있나 — 순수 판정
 *
 * ## 왜 기존 판정으로는 안 되나
 *
 * `lib/access/decide.ts` 는 **관리자를 맨 먼저 통과시킨다.** 그것이 그 판정의 옳은 규칙이다 —
 * 「관리자를 잠그면 열어 줄 사람이 사라진다」. 그런데 이 모듈은 축이 다르다.
 * 여기 든 것은 한 사람의 돈이 걸린 판단 기록이고, 명세 M11 은 **소유자만** 본다고 적는다.
 * 관리자라는 이유로 남의 매매 기록을 열람하는 문은 만들지 않는다.
 *
 * 그래서 판정을 **덧댄다**. 표면 판정(메뉴·라우트)이 먼저 걸러 주고, 그 뒤에 이 판정이 한 겹 더 선다.
 * 둘은 서로를 대신하지 않는다 — 표면 판정은 「이 화면이 이 사람에게 있는가」를,
 * 이 판정은 「이 데이터가 이 사람 것인가」를 답한다.
 *
 * ## 왜 순수 함수인가
 *
 * 문이 잠기는지 확인하려면 잠그는 규칙을 시험할 수 있어야 한다. DB 와 세션이 붙어 있으면
 * 「관리자인데 소유자가 아닌 사람」 같은 조합을 만들 수 없고, 못 만드는 조합은 안 시험한다.
 * 그리고 안 시험한 문은 열려 있는 채로 배포된다.
 */

/** 왜 그렇게 판정했나 — 화면이 사유를 말할 수 있어야 한다 */
export type TradingAccessReason =
  /** 로그인하지 않았다 */
  | 'anonymous'
  /** 소유자를 아직 안 정했다. 이때는 아무도 못 들어간다 */
  | 'no_owner'
  /** 소유자가 아니다. 관리자여도 여기서 막힌다 */
  | 'not_owner'
  | 'owner'

export interface TradingAccessDecision {
  allowed: boolean
  reason: TradingAccessReason
  /** 막힌 사람에게 보일 한 줄. 조용히 빈 화면을 주지 않는다 */
  userMessage: string | null
}

export interface TradingViewer {
  userId: string | null
  /** 판정에 **쓰지 않는다.** 받는 이유는 「관리자인데도 막힌다」를 시험하기 위해서다 */
  isAdmin: boolean
}

const OWNER: TradingAccessDecision = { allowed: true, reason: 'owner', userMessage: null }

/**
 * @param ownerUserId `trading_settings` 의 `owner_user_id`. 비어 있으면 아직 안 정한 것이다
 */
export function decideTradingAccess(
  viewer: TradingViewer,
  ownerUserId: string | null | undefined,
): TradingAccessDecision {
  if (!viewer.userId) {
    return { allowed: false, reason: 'anonymous', userMessage: '로그인이 필요합니다' }
  }

  const owner = (ownerUserId ?? '').trim()
  /**
   * 소유자가 비어 있으면 **닫는다.**
   *
   * 반대로 두면(안 정했으니 관리자에게 열어 둔다) 설정을 한 번도 안 만진 동안
   * 모든 관리자가 매매 기록을 볼 수 있다. 「아직 안 정했다」는 「아무나 봐도 된다」가 아니다.
   */
  if (owner === '') {
    return {
      allowed: false,
      reason: 'no_owner',
      userMessage: 'AI 트레이딩 소유자가 아직 지정되지 않았습니다. 설정에서 소유자를 먼저 지정해 주세요',
    }
  }

  if (viewer.userId !== owner) {
    return {
      allowed: false,
      reason: 'not_owner',
      userMessage: 'AI 트레이딩은 소유자 한 사람만 볼 수 있습니다',
    }
  }

  return OWNER
}
