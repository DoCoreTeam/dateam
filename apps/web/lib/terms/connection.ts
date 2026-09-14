// 연결 상태의 말 (SSOT)
//
// 「연결됨」을 화면마다 직접 적던 동안 같은 상태가 관리자에서는 「연결됨」,
// 콘텐츠 인텔리전스에서는 「있음/없음」, 영업 CRM 에서는 「활성」이었다.
// 상태가 같은데 말이 다르면 사용자는 그것이 같은 상태인 줄 모른다.
//
// 행동의 말(연결 해제·변경·저장)은 lib/terms/action.ts 에 있다. 여기는 상태의 말만 둔다.

export const CONNECTION = {
  /** 키나 계정이 붙어 있고 실제로 쓸 수 있는 상태 */
  connected: '연결됨',
  /** 아직 붙이지 않은 상태. 「없음」이나 「미설정」으로 쓰지 않는다 */
  notConnected: '연결 안 됨',
  /** 붙였다가 끊은 상태. 수집한 데이터는 남아 있다 */
  disconnected: '연결 해제됨',
  /** 지금 확인하는 중 */
  checking: '확인 중',
} as const

export type ConnectionKey = keyof typeof CONNECTION
