// 검토 항목(review_items) channel 값 SSOT — DB CHECK(review_items_channel_check)와 일치.
//   commit 시 supply_quotes.source_format으로 그대로 매핑됨(review/[id] 라우트).
//   채널 키를 화면·라우트마다 문자열로 박지 말고 이 상수를 import.
export const REVIEW_CHANNELS = {
  MAIL: 'mail',
  MSG: 'msg',
  PDF: 'pdf',
  IMG: 'img',
  OWN: 'own',
  MARKET_LINK: 'market_link', // 경쟁사 시장가 동기화(추종가) — 088 마이그로 CHECK 추가
} as const

export type ReviewChannel = (typeof REVIEW_CHANNELS)[keyof typeof REVIEW_CHANNELS]
