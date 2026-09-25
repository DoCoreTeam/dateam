/**
 * 그날 세션 창을 **없으면 만들어서** 돌려준다 — 순수 판정
 *
 * ## 왜 이 자리가 따로 있나 (실측 2026-09-26)
 *
 * `seedRegularSessions` 를 만들어 놓고 **아무도 안 불렀다.** 그래서 세션 캘린더가
 * 영원히 비었고, 매분 도는 크론은 「오늘 세션 정보가 없어 건너뜁니다」로 끝났다 —
 * 봉이 한 줄도 안 쌓이는데 오류는 한 건도 안 났다.
 *
 * 채우는 일을 「운영자가 미리 해 두는 것」으로 두면 안 해 둔 날이 반드시 온다.
 * 크론이 **그날 필요한 줄을 스스로 세우고 계속 간다.**
 *
 * ## 무엇을 안 하나
 *
 * 이미 있는 줄은 건드리지 않는다. 관리자가 고쳐 둔 개장 시간이 자동 생성으로 되돌아가면
 * 그날 판단 구간이 통째로 어긋나고, 화면에는 아무 일도 안 일어난 것으로 보인다.
 */

export type EnsureAction =
  /** 이미 있다. 그대로 쓴다 */
  | { kind: 'use' }
  /** 없다. 세우고 쓴다 */
  | { kind: 'create'; isExpiryDay: boolean }
  /** 주말이라 안 세운다 */
  | { kind: 'skip'; reason: 'weekend' }

export interface EnsureInput {
  /** `YYYY-MM-DD` (서울) */
  tradeDate: string
  /** 이미 캘린더에 줄이 있나 */
  exists: boolean
  isWeekend: boolean
  /** 이 상품의 최종거래일들. 그 날이면 접속매매가 15:20 에 끝난다 */
  lastTradingDays: ReadonlySet<string>
}

export function decideEnsureSession(input: EnsureInput): EnsureAction {
  // 있는 것이 먼저다. 주말이어도 관리자가 세워 뒀으면 그 판단을 존중한다
  if (input.exists) return { kind: 'use' }
  if (input.isWeekend) return { kind: 'skip', reason: 'weekend' }
  return { kind: 'create', isExpiryDay: input.lastTradingDays.has(input.tradeDate) }
}
