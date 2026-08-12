// lib/ui/ime.ts — 한글(및 일본어·중국어) IME 조합 중의 Enter를 걸러내는 SSOT.
//
// 왜: 한글은 글자를 "조합"하다가 Enter로 확정한다. 그 Enter는 keydown으로도 올라오기 때문에,
// 화면이 Enter를 곧바로 "추가/제출"로 처리하면 조합이 끝나기 전에 값이 먹히고, 뒤이어 확정된
// 마지막 글자가 입력창에 남아 한 번 더 들어간다.
// (실제 사고: 회의노트 태그에 "숙명여대"를 치고 Enter → `#숙명여대`와 `#대`가 둘 다 생성됨)
//
// 그래서 Enter를 행동으로 바꾸는 모든 입력은 이 모듈을 거친다. 화면마다 `isComposing`을
// 따로 적어 넣으면 반드시 빠뜨리는 곳이 생긴다(실제로 21곳 중 1곳만 처리돼 있었다).
// 가드: lib/ui/ime-enter-guard.test.ts (정적 스캔 — 맨손 Enter 처리 재유입 차단)

/** IME가 글자를 조합하는 중인가. keyCode 229는 isComposing 미지원 브라우저 폴백. */
export function isImeComposing(e: {
  nativeEvent?: { isComposing?: boolean }
  keyCode?: number
}): boolean {
  if (e.nativeEvent?.isComposing) return true
  return e.keyCode === 229
}

/** "사용자가 실제로 누른 Enter"인가 — IME 확정 Enter는 false. */
export function isEnterKey(e: {
  key: string
  nativeEvent?: { isComposing?: boolean }
  keyCode?: number
}): boolean {
  return e.key === 'Enter' && !isImeComposing(e)
}
