/**
 * 이 견적의 «원본»은 어느 첨부인가 — **한 곳에서만 고른다**
 *
 * 단추(대조할지 올릴지)와 오버레이(무엇을 그릴지)가 같은 답을 봐야 한다.
 * 두 곳이 각자 고르면 「단추는 떴는데 열면 다른 파일」이 되고, 그건 대조를 못 믿게 만든다.
 *
 * 화면 부품(`QuoteOriginalCompare.tsx`)이 아니라 여기 있는 이유: JSX 가 섞인 파일은
 * `node --test` 가 못 읽어 **규칙을 실제로 돌려 볼 수 없다.** 규칙은 평범한 함수로 두고
 * 부품이 불러다 쓴다.
 */

/** 첨부 목록에서 이 규칙이 보는 것만 */
export interface OriginalCandidate {
  id: string
  fileName: string
  mimeType: string | null
  kind: string
  createdAt: string
}

/** 화면 안에 그릴 수 있는 형식인가 */
export type DrawKind = 'pdf' | 'image' | 'other'

export function drawKindOf(mimeType: string | null | undefined): DrawKind {
  const m = (mimeType ?? '').toLowerCase()
  if (m === 'application/pdf') return 'pdf'
  if (m.startsWith('image/')) return 'image'
  return 'other'
}

/**
 * 원본 고르기.
 *
 * 매입 견적서(`SUPPLY_QUOTE`)가 먼저다 — 파일로 가져오기가 원본을 붙일 때 쓰는 종류이고,
 * 대조 화면의 올리기도 같은 종류로 붙인다. 그 종류가 하나도 없을 때만 나머지를 본다:
 * 사람이 첨부 절에서 종류를 다르게 골라 올린 원본을 「없다」고 하면, 파일은 붙어 있는데
 * 대조만 안 되는 상태가 된다.
 *
 * 같은 무리에서 여럿이면 **가장 나중 것**이다. 다시 올렸다는 것은 앞의 것이 틀렸다는 뜻이다.
 */
export function pickOriginal<T extends OriginalCandidate>(items: readonly T[]): T | null {
  const newest = (list: readonly T[]) =>
    [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  const supply = items.filter((i) => i.kind === 'SUPPLY_QUOTE')
  return newest(supply) ?? newest(items)
}
