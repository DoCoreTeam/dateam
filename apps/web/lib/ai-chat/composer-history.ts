// Composer ↑↓ 입력 히스토리 이동의 순수 계산(SSOT·테스트 대상).
// 포인터 규약: -1 = 라이브 초안(탐색 안 함), 0..len-1 = history 인덱스(오래된→최신).

/** ↑ : 더 오래된 항목으로. 탐색 시작(-1)이면 가장 최신(len-1)부터. */
export function historyPrev(histIndex: number, len: number): number {
  if (len === 0) return -1
  return histIndex === -1 ? len - 1 : Math.max(0, histIndex - 1)
}

/** ↓ : 더 최신 항목으로. 최신을 넘어서면 -1(초안=빈칸 복귀). */
export function historyNext(histIndex: number, len: number): number {
  if (histIndex === -1 || histIndex >= len - 1) return -1
  return histIndex + 1
}
