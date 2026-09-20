/**
 * 원본이 묶어 부른 대로 **견적 묶음**을 만든다 (SSOT)
 *
 * ## 왜 화면 부품이 아니라 여기 있나
 *
 * `@/` 로 시작하는 import 가 섞인 파일은 `node --test` 가 못 읽는다. 그러면
 * 규칙을 **실제로 돌려 볼 수 없고**, 안 돌려 본 규칙은 가드가 아니다
 * (`quote-spec.ts` 가 같은 이유로 떨어져 나왔다).
 *
 * ## 규칙 둘
 *
 * ① **차례는 원본에 나온 순서다.** 이름순으로 정렬하면 원본과 견적의 줄 순서가 갈리고,
 *   그러면 나란히 놓고 대조하는 일이 어려워진다.
 * ② **이름이 하나도 없으면 묶음을 안 만든다.** 빈 묶음 하나에 전부 들어가면 소계가
 *   합계와 같은 값을 한 번 더 말할 뿐이고, 화면에는 뜻 없는 줄이 하나 는다.
 */

export interface QuoteGrouping {
  /** 만들 묶음. 비어 있으면 묶음 없는 견적이다 */
  sections: { name: string }[]
  /** 고른 줄과 **같은 차례**. 묶이지 않은 줄은 null */
  sectionIndexes: (number | null)[]
}

/**
 * 고른 줄들의 묶음 이름으로 묶음을 짠다.
 *
 * @param labels 고른 줄과 같은 차례의 묶음 이름(없으면 null)
 */
export function groupPickedLines(labels: readonly (string | null)[]): QuoteGrouping {
  const names: string[] = []
  for (const raw of labels) {
    const name = (raw ?? '').trim()
    if (name && !names.includes(name)) names.push(name)
  }
  if (names.length === 0) {
    return { sections: [], sectionIndexes: labels.map(() => null) }
  }
  return {
    sections: names.map((name) => ({ name })),
    sectionIndexes: labels.map((raw) => {
      const at = names.indexOf((raw ?? '').trim())
      return at >= 0 ? at : null
    }),
  }
}
