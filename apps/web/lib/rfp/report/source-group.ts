/**
 * 원문 블록을 절 단위로 묶는다 (사용자 개입)
 *
 * ## 왜 화면에서 떼어 냈나
 *
 * 화면 파일(.tsx)에 있으면 단위 테스트가 못 부른다. 그런데 이 판정은
 * **원문이 문서로 보이느냐 글 덩어리로 보이느냐**를 정하는 자리라 실행해서 확인해야 한다.
 */

/** 화면이 읽는 원문 블록 한 줄 */
export interface SourceBlock {
  blockId: string
  text: string
  html?: string | null
  pageNo: number | null
  type: string
  sectionId?: string | null
  sectionNumber?: string | null
  sectionTitle?: string | null
  sectionLevel?: number | null
}

/**
 * 이 깊이까지만 제목으로 그린다.
 *
 * 제목 찾기가 본문을 제목으로 잘못 보는 일이 있다 — 실측 2026-09-09:
 * 「(기간/예산) 24~30년 / 총 4,793억 페소…」가 5단계 절이 됐다.
 * 깊은 것을 전부 제목으로 그리면 본문이 제목으로 뒤덮인다.
 */
export const MAX_HEADING_LEVEL = 3

export interface SourceGroup {
  key: string
  number: string | null
  title: string | null
  blocks: SourceBlock[]
}

/** 블록을 절 단위로 묶는다 — 제목이 바뀌는 자리에서 끊는다 */
export function groupBySection(blocks: readonly SourceBlock[]): SourceGroup[] {
  const groups: SourceGroup[] = []
  for (const b of blocks) {
    const heading = (b.sectionLevel ?? 99) <= MAX_HEADING_LEVEL && Boolean(b.sectionTitle || b.sectionNumber)
    const key = heading ? String(b.sectionId) : '__body__'
    const last = groups[groups.length - 1]
    if (last && last.key.startsWith(`${key}-`)) {
      last.blocks.push(b)
      continue
    }
    groups.push({
      key: `${key}-${groups.length}`,
      number: heading ? b.sectionNumber ?? null : null,
      title: heading ? b.sectionTitle ?? null : null,
      blocks: [b],
    })
  }
  return groups
}
