/**
 * 참석자 칩을 무엇으로 그리고 무엇을 저장할지 (SSOT)
 *
 * **왜 이 파일이 생겼나**: 이어진 사람의 이름을 `attendees` 에도 함께 남긴다 —
 * 그래야 이 화면을 모르는 다른 화면(목록·정리·발행)이 참석자를 온전히 본다.
 * 그런데 그러면 화면을 다시 열 때 같은 사람이 **인물 칩과 글자 칩으로 두 번** 뜬다.
 *
 * 처음엔 인물 조회가 끝나는 자리에서 글자 칩을 빼도록 짰는데,
 * 조직원 조회와 인물 조회가 **둘 다 비동기**라 도착 순서에 따라 결과가 갈렸다.
 * 실브라우저에서 「곽수영 제일엔지니어링」과 「곽수영」이 나란히 떴다(2026-09-05 실측).
 * tsc·단위테스트·design:check 는 전부 초록이었다 — 순서 의존은 정적 검사가 못 본다.
 *
 * 그래서 계산으로 뺀다. 순서에 기대지 않으면 애초에 갈릴 것이 없다.
 */

/** 이어진 사람은 글자 칩으로 또 보이지 않는다 */
export function visibleExternals(externals: string[], linkedNames: string[]): string[] {
  if (linkedNames.length === 0) return externals
  const linked = new Set(linkedNames)
  return externals.filter((n) => !linked.has(n))
}

/**
 * 저장할 참석자 이름 — 조직원 · 이어진 사람 · 남은 글자 순서.
 *
 * 이어진 사람의 이름을 빼면 이 화면 밖에서는 참석자가 사라진 것처럼 보인다.
 * 그래서 넣되, **한 번만** 넣는다.
 */
export function attendeeNamesForSave(
  memberNames: string[],
  linkedNames: string[],
  externals: string[],
): string[] {
  return [...memberNames, ...linkedNames, ...visibleExternals(externals, linkedNames)]
}
