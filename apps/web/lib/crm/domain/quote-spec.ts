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
  /*
    **개행이 먼저다.** 사람이 손으로 그은 줄 경계가 원문 표식보다 세다 —
    편집기에서 일부러 나눈 줄을 우리가 다시 합치거나 더 가르면, 적은 대로 안 나온다.
  */
  const written = (descriptionMd ?? '').split('\n').map((l) => l.trim()).filter(Boolean)

  /*
    개행이 하나도 없이 한 덩어리로 온 글만 표식으로 가른다(`splitInlineMarks`).
    파일에서 읽어 온 규격이 그렇게 온다 — 원문에는 줄이 있었는데 글자로 옮겨지며 합쳐진 것이다.
  */
  const lines = written.length === 1 ? splitInlineMarks(written[0]) : written

  return { spec: lines[0] ?? '', components: lines.slice(1) }
}

/*
  ── 개행 없이 한 덩어리로 온 규격 ──────────────────────────────

  파일에서 읽어 온 규격은 개행이 하나도 없이 오는 일이 있다. 원본 PDF 에서는
  줄마다 나뉘어 있던 사양이 글자로 옮겨지면서 한 문단이 되고, 그러면 견적서에
  쭉 이어져 어디서 끊기는지 사람이 못 읽는다(사용자 지적 2026-09-21:
  「번호 1번에 품목 내용 보면 그냥 구분이 없자나」).

  **그런데 표식은 남아 있다.** 원문이 목록으로 적었던 자리에는 가운뎃점이,
  제목을 이어 붙인 자리에는 공백으로 둘러싸인 대시가 그대로 있다. 그 자리는
  우리가 정한 경계가 아니라 **원문이 이미 그어 둔 경계**다.

  그래서 여기서 가르는 것은 지어내는 것이 아니다 — 표식이 없으면 한 글자도
  건드리지 않는다(`quote-components.ts` 와 같은 약속).
*/

/**
 * 원문이 목록 표식으로 쓰는 글자들 — 이 앞에서 줄이 바뀐다.
 *
 * **가운뎃점(`·`)은 여기 없다.** 한국어에서는 낱말을 잇는 자리에도 쓰여
 * (「SXM5 · 3년 무상보증 포함」) 목록 표식으로 보면 한 값이 두 줄로 갈린다.
 */
const BULLETS = '•‣▪◦●○'

/**
 * 조각이 너무 짧으면 표식이 아니라 글 속의 글자다.
 * 「A - B」 같은 범위 표기가 줄로 갈리는 것을 막는다.
 */
const MIN_PIECE = 8

/**
 * 개행 없이 온 한 덩어리를 **원문 표식 자리에서** 줄로 가른다.
 *
 * 표식이 없거나 갈린 조각이 쓸 만큼 길지 않으면 원래 글 한 줄을 그대로 돌려준다.
 *
 * @param text 개행이 없는 규격 한 덩어리
 */
export function splitInlineMarks(text: string): string[] {
  const one = text.trim()
  if (!one) return []

  // 가운뎃점이 먼저다 — 목록 표식이라 뜻이 또렷하고, 대시보다 덜 흔하다
  const byBullet = one
    .split(new RegExp(`\\s*[${BULLETS}]\\s*`))
    .map((p) => p.trim())
    .filter(Boolean)
  if (byBullet.length >= 2) return byBullet.flatMap(splitByDash)

  return splitByDash(one)
}

/**
 * 공백으로 둘러싸인 대시에서 가른다 — 원문이 제목 줄들을 이어 붙인 자리다.
 *
 * **낱말 안 하이픈은 건드리지 않는다.** 「R283-Z96-AAJ1」처럼 양옆이 글자인
 * 하이픈은 모델명의 일부이지 경계가 아니다. 그래서 앞뒤 공백을 반드시 본다.
 *
 * **숫자 뒤라고 막지 않는다.** 한때 「3.55 - 4.4GHz」를 범위로 보고 막았는데,
 * 그 규칙이 「AMD EPYC 9005/9004 - 4U DP 8 x PCIe GPUs」라는 **진짜 경계까지 막았다**
 * (실측 DA-2026-0921-04). 실제 견적서는 범위에 물결(`3.55~4.4GHz`)을 쓴다 —
 * 막아야 했던 것은 짐작이었고, 짧은 조각을 걸러내는 `MIN_PIECE` 로 충분하다.
 */
function splitByDash(text: string): string[] {
  const pieces = text
    .split(/\s+[-–—]\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (pieces.length < 2) return [text]

  // 한 조각이라도 너무 짧으면 그 대시는 경계가 아니었다 — 통째로 되돌린다
  if (pieces.some((p) => p.length < MIN_PIECE)) return [text]
  return pieces
}
