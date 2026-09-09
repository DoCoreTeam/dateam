/**
 * 문서 내보내기 — 미리보기에서 쓰는 말 (용어집 §01 2층)
 *
 * 견적서만이 아니라 계약서·거래명세서·발주서가 함께 쓰는 표면이라
 * `quote.ts` 가 아니라 여기 둔다.
 */

/** 「한 장에 맞춰 줄였다」는 사실을 배지로 말한다 */
export const FIT_ON = '한 장 맞춤'
/** 줄이지 않은 상태 */
export const FIT_OFF = '원래 크기'
export const FIT_SMALLER = '더 줄이기'
export const FIT_BIGGER = '더 키우기'
export const PREVIEW_CLOSE = '미리보기 닫기'

/** 왜 줄였는지 — 배지만 보면 「왜 작지?」가 된다 */
export function fitReason(percent: number): string {
  return `한 쪽에서 넘쳐 ${percent}% 로 줄였어요. 「${FIT_OFF}」로 되돌릴 수 있어요.`
}

/**
 * 지금 배율로는 한 장에 안 들어가는 문서.
 *
 * 억지로 더 줄이면 종이에서 읽을 수 없다. 그때는 두 장이 맞고,
 * **어디서 끊기는지**를 미리 말해 주는 것이 우리가 할 일이다.
 *
 * **「줄여도」라고 쓰지 않는다.** 사람이 −/+ 로 100% 까지 올려 놓은 상태에도 이 문구가 뜬다 —
 * 그때 「100% 까지 줄여도」는 사실이 아니다(실화면에서 밟았다). 지금 배율만 말한다.
 */
export function tooLongNote(percent: number): string {
  return `지금 배율(${percent}%)로는 한 장에 안 들어가요. 두 장으로 나가고, 거래 조건·특기사항은 통째로 다음 장에 실립니다.`
}

/** 줄이지 않아도 한 장인 문서에는 아무 말도 하지 않는다 — 늘 뜨는 안내는 아무도 안 읽는다 */
export const FIT_NOT_NEEDED = ''
