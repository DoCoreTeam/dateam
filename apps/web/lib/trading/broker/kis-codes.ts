/**
 * 증권사가 준 코드를 **사람 말로** — 실제로 물어보고 적은 표
 *
 * ## 왜 표가 필요했나 (사용자 지적 2026-09-28 「에러인듯?」)
 *
 * 운영 「최근 실행」에 `체결 조회가 실패했습니다: kis:kis_APAC0071` 이 매분 빨갛게 떴다.
 * 그 코드만으로는 **무엇이 문제인지도, 어디서 고치는지도** 알 수 없다 —
 * 그래서 사흘 동안 아무도 못 고쳤고 그동안 안전 게이트가 닫혀 신호가 0건이었다.
 *
 * ## 짐작으로 안 적었다
 *
 * 아래 뜻은 **실제로 그 조회를 날려 증권사가 준 `msg1` 을 읽고** 적은 것이다.
 * 실측 2026-09-28: 선물옵션 주문체결내역조회(TTTO5201R)에 저장된 계좌로 물었더니
 * `rt_cd=7 · msg_cd=APAC0071 · msg1=「계좌번호가 존재하지 않습니다.」` 였고,
 * 상품코드를 01·03·22·29·04 로 바꿔 봐도 같은 답이었다 — 계좌번호 자체가 그 계정에 없다.
 *
 * ## 증권사 원문을 화면에 안 싣는다
 *
 * `msg1` 에는 계좌나 내부 구조가 섞여 나올 수 있다(S3). 그래서 **우리가 적은 말**을 쓰고,
 * 원문은 시스템 로그로만 보낸다(`lib/trading/broker/account.ts` 의 `noteBrokerRefusal`).
 */

export interface KisCodeMeaning {
  /** 무엇이 문제인가 */
  why: string
  /** 무엇을 하면 풀리나. 갈 곳을 짚는다 */
  how: string
  /** 사람이 손대야 풀리나 (`blocked`), 기다리면 풀리나 (`waiting`) */
  tone: 'blocked' | 'waiting'
  /** 언제 무엇을 보고 적었나. 짐작과 실측을 섞지 않는다 */
  source: string
}

export const KIS_CODE_MEANING: Readonly<Record<string, KisCodeMeaning>> = {
  APAC0071: {
    why: '증권사에 그 계좌번호가 없습니다',
    how: '트레이딩 설정의 증권사 자격증명에서 선물옵션 계좌번호를 다시 넣어 주세요',
    tone: 'blocked',
    source: '실측 2026-09-28 msg1 「계좌번호가 존재하지 않습니다.」 (상품코드 다섯을 다 시도해도 같음)',
  },
  EGW00133: {
    why: '증권사 접속 토큰을 너무 자주 받았습니다',
    how: '1분에 한 번만 받을 수 있습니다. 잠시 뒤 스스로 다시 받습니다',
    tone: 'waiting',
    source: '실측 2026-09-28 error_description 「접근토큰 발급 잠시 후 다시 시도하세요(1분당 1회)」',
  },
  EGW00201: {
    why: '증권사에 너무 빨리 이어서 물었습니다',
    how: '다음 분에 스스로 다시 부릅니다. 자주 나면 트레이딩 설정의 「증권사 호출 간격」을 늘려 주세요',
    tone: 'waiting',
    source: '실측 2026-09-29 msg1 「초당 거래건수를 초과하였습니다.」 (분봉 조회 6건 · 잔고 조회 13건)',
  },
  SKFT2101: {
    why: '증권사가 예수금을 한 건으로 못 찾았습니다',
    how: '선물옵션 계좌가 맞는지 확인해 주세요. 계좌번호가 틀리면 이 답이 같이 납니다',
    tone: 'blocked',
    source: '실측 2026-09-29 msg1 「정확히 1건의 레코드가 조회되어야 합니다.」 (예수금 조회 1,015건)',
  },
  KIOK0560: {
    why: '그 계좌에 선물옵션 잔고가 없습니다',
    how: '계좌번호가 맞는데도 이 답이 나면 아직 들고 있는 것이 없다는 뜻입니다',
    tone: 'waiting',
    source: '실측 2026-09-29 msg1 「조회할 내용이 없습니다」 (잔고 조회 322건)',
  },
}

/**
 * 코드 하나를 뜻으로. 모르는 코드는 **null** 이다 —
 * 지어낸 뜻을 붙이면 읽는 사람이 엉뚱한 곳을 고친다.
 */
export function kisCodeMeaning(code: string): KisCodeMeaning | null {
  return KIS_CODE_MEANING[code.trim()] ?? null
}

/**
 * 어느 조회였나 — 사유 뒤에 붙는 이름(`minuteChart`·`fills`)을 사람 말로.
 *
 * 이름 그대로 두면 「minuteChart 조회가 거절됐습니다」가 된다. 읽는 사람은 그것이
 * 시세인지 계좌인지 모르고, 시세가 죽은 것과 계좌가 죽은 것은 할 일이 다르다.
 */
export const BROKER_CALL_LABEL: Readonly<Record<string, string>> = {
  minuteChart: '분봉',
  fills: '체결',
  nightFills: '야간 체결',
  balance: '잔고',
  nightBalance: '야간 잔고',
  deposit: '예수금',
}
