/**
 * 규격과 구성을 한 칸에 담고 다시 가르는 규칙 (SSOT)
 *
 * ## 왜 화면 부품이 아니라 여기 있나
 *
 * `@/` 로 시작하는 import 가 섞인 파일은 `node --test` 가 못 읽는다. 그러면
 * **규칙을 실제로 돌려 볼 수 없고**, 돌려 보지 않은 규칙은 가드가 아니다
 * (`ui/quote-original.ts` 가 같은 이유로 떨어져 나왔다).
 *
 * ## 왜 칸을 새로 안 만드나
 *
 * 저장 칸(`descriptionMd`)은 길이 제한이 없는 글이라 구성 열세 줄이 그대로 들어간다.
 * 칸을 새로 만들면 표를 고치고 저장·읽기·인쇄·엑셀을 전부 다시 밟아야 하고,
 * 그러는 동안 구성은 여전히 사라진 채로 있다. **담을 그릇이 이미 있으면 그걸 쓴다.**
 *
 * 첫 줄이 규격, 그 아래가 구성이다. 화면도 종이도 이 약속대로 그린다.
 */

/**
 * 규격 한 줄과 구성 여러 줄을 **한 칸에** 담는다.
 *
 * ## 왜 칸을 새로 안 만드나
 *
 * 저장 칸(`descriptionMd`)은 길이 제한이 없는 글이라 구성 열세 줄이 그대로 들어간다.
 * 칸을 새로 만들면 표를 고치고, 저장·읽기·인쇄·엑셀·내보내기를 전부 다시 밟아야 한다 —
 * 그러는 동안 구성은 여전히 사라진 채로 있다. **담을 수 있는 그릇이 이미 있으면 그걸 쓴다.**
 *
 * 첫 줄이 규격, 그 아래가 구성이다. 인쇄가 이 약속대로 그린다.
 */
export function joinSpec(spec: string | null, components: readonly string[] | null | undefined): string {
  const head = (spec ?? '').trim()
  const rest = (components ?? []).map((c) => c.trim()).filter(Boolean)
  return [head, ...rest].filter(Boolean).join('\n')
}

/**
 * 붙여 둔 것을 다시 가른다 — 첫 줄이 규격, 나머지가 구성.
 *
 * 인쇄와 엑셀이 「규격은 작게, 구성은 목록으로」를 그리려면 다시 갈라야 한다.
 * 가르는 규칙이 두 곳에 생기면 한쪽이 첫 줄을 구성에 넣고, 그러면 같은 견적이
 * 화면과 종이에서 다르게 보인다.
 */
export function splitSpec(descriptionMd: string | null | undefined): { spec: string; components: string[] } {
  const lines = (descriptionMd ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  return { spec: lines[0] ?? '', components: lines.slice(1) }
}
