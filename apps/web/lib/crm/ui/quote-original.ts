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

/**
 * 화면 안에 그릴 수 있는 형식인가.
 *
 * `sheet` 는 브라우저가 못 그리는 형식이지만 **우리가 표로 펴서 그릴 수 있는** 것이다.
 * 예전에는 엑셀 원본이 통째로 `other` 로 떨어져 「이 형식은 화면 안에 못 그려요」로 끝났다 —
 * 그런데 견적서는 엑셀로 오는 일이 흔하고, 그때 대조 화면은 아무 쓸모가 없었다.
 */
export type DrawKind = 'pdf' | 'image' | 'sheet' | 'other'

/** 우리가 표로 펴서 그릴 수 있는 형식 */
const SHEET_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
])

export function drawKindOf(mimeType: string | null | undefined): DrawKind {
  const m = (mimeType ?? '').toLowerCase().split(';')[0].trim()
  if (m === 'application/pdf') return 'pdf'
  if (m.startsWith('image/')) return 'image'
  if (SHEET_MIMES.has(m)) return 'sheet'
  return 'other'
}

/**
 * 원본 고르기.
 *
 * **조각이 있으면 조각이 먼저다.** 한 파일에 견적이 두 건 들어 있으면 파일 전체를
 * 세워 봐야 사람이 그 안에서 자기 건을 찾아야 한다 — 그러라고 오려 둔 것이 조각이다
 * (사용자 지적 2026-09-20: 「거기 두개가 들어 있는데 찾아서 확인해야 하자나」).
 *
 * 조각이 없으면 매입 견적서(`SUPPLY_QUOTE`)다 — 파일로 가져오기가 원본을 붙일 때 쓰는
 * 종류이고, 대조 화면의 올리기도 같은 종류로 붙인다. 그 종류가 하나도 없을 때만 나머지를
 * 본다: 사람이 첨부 절에서 종류를 다르게 골라 올린 원본을 「없다」고 하면, 파일은 붙어
 * 있는데 대조만 안 되는 상태가 된다.
 *
 * 같은 무리에서 여럿이면 **가장 나중 것**이다. 다시 올렸다는 것은 앞의 것이 틀렸다는 뜻이다.
 *
 * **조각 id 가 가리키는 첨부가 사라졌으면 그냥 다음 규칙으로 간다.** 첨부는 사람이 지울 수
 * 있고, 그때 화면이 빈 칸이 되면 대조 자체를 못 하게 된다.
 */
export function pickOriginal<T extends OriginalCandidate>(
  items: readonly T[],
  snapshotId?: string | null,
): T | null {
  const newest = (list: readonly T[]) =>
    [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  const cut = snapshotId ? items.find((i) => i.id === snapshotId) ?? null : null
  if (cut) return cut
  const supply = items.filter((i) => i.kind === 'SUPPLY_QUOTE')
  return newest(supply) ?? newest(items)
}

/**
 * 파일 전체를 열 때 **몇 쪽부터 열까**.
 *
 * 쪽을 알면 그 쪽으로 데려다 준다. 모르면 아무것도 안 붙인다 — 1쪽이라고 넘겨짚으면
 * 두 건짜리 파일에서 늘 첫 건을 가리키게 되고, 그게 지금까지의 모습이다.
 *
 * 뒤에 붙는 값은 브라우저 뷰어가 읽는 것이라 파일 내용이나 주소에 영향을 주지 않는다.
 */
export function pdfViewerHash(pageStart: number | null | undefined): string {
  const base = '#navpanes=0&view=FitH'
  const page = typeof pageStart === 'number' && Number.isFinite(pageStart) && pageStart >= 1
    ? Math.floor(pageStart) : null
  return page ? `${base}&page=${page}` : base
}
