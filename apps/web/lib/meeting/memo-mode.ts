// lib/meeting/memo-mode.ts — 회의 본문 편집기를 **읽기로 열지 쓰기로 열지** 정하는 SSOT
//
// 왜 컴포넌트 밖인가: 이 판정이 틀리면 ① 읽으러 온 화면에 커서가 들어가거나
// ② 회의 중에 받아적기가 한 번 더 눌러야 하는 일이 된다. 둘 다 사용자가 겪고서야 안다.
// `useState(() => …)` 안의 식으로 두면 **실브라우저 말고는 검증할 수단이 없다**(E-6).
//
// 규칙은 셋이고, 순서가 곧 우선순위다.

export interface MemoModeInput {
  /** 서버에 저장된 본문에 **읽을 글자**가 있는가 (태그만 있는 빈 본문은 false) */
  hasBody: boolean
  /** 이 브라우저에 아직 서버로 못 보낸 임시저장본이 있는가 */
  hasDraft: boolean
}

/**
 * 편집기를 쓰기 모드로 열어야 하는가.
 *
 * ① **임시저장본이 있으면 쓰기.** 복원 배너는 쓰기 화면에만 있다 —
 *    읽기 뒤에 숨기면 브라우저에 남은 글이 영영 안 돌아온다. 이게 가장 세다.
 * ② **본문이 비었으면 쓰기.** 읽을 것이 없는 화면에 「수정」 관문을 두면
 *    회의 중에 받아적는 것을 막는다(「작성」 탭의 뜻 그대로).
 * ③ **그 밖에는 읽기.** 끝난 회의를 다시 읽다가 실수로 글자가 지워져도
 *    5초 뒤 저절로 저장되는 구조라, 기본이 쓰기이면 조용히 망가진다.
 */
export function shouldStartWriting({ hasBody, hasDraft }: MemoModeInput): boolean {
  if (hasDraft) return true
  return !hasBody
}

/**
 * 태그를 뺀 글자 수 — 「읽을 글자가 있는가」의 판정 근거.
 *
 * Tiptap 은 빈 본문에도 `<p></p>` 를 남긴다. 그래서 HTML 길이로 재면
 * **빈 노트가 «본문 있음»으로 잡혀** 읽기 모드로 열리고, 사용자는 빈 화면 앞에서
 * 「수정」을 한 번 더 눌러야 한다.
 */
export function plainTextLength(html: string): number {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length
}
