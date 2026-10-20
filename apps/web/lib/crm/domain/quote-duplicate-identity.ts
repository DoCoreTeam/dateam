/**
 * 복제한 견적이 무엇으로 불리는가 — 판 번호·제목·안 이름
 *
 * **개정과 다른 안은 뜻이 다르다.** 개정은 앞 판을 대체하므로 판 번호가 오르고,
 * 다른 안은 나란히 사는 **새 문서**라 판 번호가 1 에서 시작한다.
 * 원본의 Rev.2 를 물려받으면 한 번도 고친 적 없는 안이 「Rev.2」로 인쇄된다
 * (실측 2026-10-20 DA-2026-1020-01·02).
 *
 * **안 이름은 뱃지 하나로만 말한다.** 제목에도 덧붙이면 같은 말이 두 번 보이고,
 * 안에서 안을 만들면 「(gcube edge) (2안)」처럼 꼬리가 쌓인다.
 */
export type DuplicateMode = 'revision' | 'variant'

export interface DuplicateSource {
  title: string
  revision: number
  variantLabel: string | null
}

export interface DuplicateIdentity {
  title: string
  revision: number
  variantLabel: string | null
}

const FALLBACK_VARIANT_LABEL = '다른 안'

/** 예전 판이 제목에 붙여 둔 「 (안 이름)」 꼬리를 뗀다 */
export function baseQuoteTitle(title: string, variantLabel: string | null): string {
  if (!variantLabel) return title
  const tail = ` (${variantLabel})`
  return title.endsWith(tail) ? title.slice(0, -tail.length) : title
}

export function duplicateIdentity(
  src: DuplicateSource,
  mode: DuplicateMode,
  label: string | null,
): DuplicateIdentity {
  if (mode === 'revision') {
    return { title: src.title, revision: src.revision + 1, variantLabel: src.variantLabel }
  }
  return {
    title: baseQuoteTitle(src.title, src.variantLabel),
    revision: 1,
    variantLabel: label ?? FALLBACK_VARIANT_LABEL,
  }
}

/**
 * 다른 안 만들기 창의 기본 이름. 안 이름 없는 원본이 1안이므로 이미 있는 안 수에 2 를 더한다.
 * 늘 「2안」을 넣으면 안이 이미 둘인 딜에서 2안이 둘 생긴다.
 */
export function nextVariantLabel(existing: ReadonlyArray<{ variantLabel?: string | null }>): string {
  return `${existing.filter((q) => q.variantLabel).length + 2}안`
}
