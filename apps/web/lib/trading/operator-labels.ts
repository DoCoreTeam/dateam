/**
 * AI 운영자 화면이 쓰는 말 — **화면 파일 안에 두지 않는다**
 *
 * 라벨 표가 화면에 있으면 같은 개념이 화면마다 다른 말이 된다
 * (`lib/ui/glossary.test.ts` 가 화면 안 라벨 표가 늘어나는 것을 막는다).
 */

export const CHECK_STATUS_LABEL: Record<string, string> = {
  ok: '정상',
  warn: '경고',
  fail: '실패',
  // 「괜찮다」가 아니다. 모르는 것은 모른다고 적는다
  unknown: '모름',
}
