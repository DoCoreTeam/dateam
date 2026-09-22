/**
 * 저장된 설정값이 «지금 고를 수 있는 것» 안에 있나.
 *
 * ## 왜 이 판정이 화면 밖에 있나 (실측 2026-09-20 ~ 09-22)
 *
 * `ai.model.extract` 에 `global-model` 이 들어앉아 추출 기능 전체가 멈춘 동안,
 * 설정 화면은 **멀쩡해 보였다.** `<select>` 는 맞는 `<option>` 이 없으면 첫 항목을 그린다 —
 * 화면은 「자동 (지금은 Gemini)」라고 말했고, 그래서 아무도 그 자리를 의심하지 않았다.
 *
 * 화면이 거짓말을 하지 않게 하는 판정은 화면 안에 두면 검사할 수가 없다(클라이언트 부품은
 * CSS 모듈·React 를 물고 있어 단위 테스트에서 못 읽는다). 그래서 여기 둔다.
 */

export interface ChoiceLike {
  value: string
}

/**
 * 목록 밖의 값이면 그 값을, 아니면 null.
 *
 * 저장된 값이 없으면(기본값으로 도는 중) 이상할 것이 없으므로 null 이다.
 */
export function unknownChoiceValue(
  value: string | null | undefined,
  choices: readonly ChoiceLike[] | null | undefined,
): string | null {
  if (!value) return null
  return (choices ?? []).some((c) => c.value === value) ? null : value
}
