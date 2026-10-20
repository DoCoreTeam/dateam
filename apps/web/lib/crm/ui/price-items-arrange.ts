/**
 * 가격 기준 품목 판의 순서 계산 (순수 함수)
 *
 * 화면(ItemsBoard)이 끌어 놓은 결과를 이 셋으로 만든다. 부품 안에 두면 node --test 가 못 읽어
 * 실브라우저 말고 검증할 길이 없는데, 결과가 곧바로 서버에 저장되므로 틀리면 순서가 틀어진다.
 */

export interface ArrangeItem {
  id: string
  section: string | null
  position: number
}

const sectionOf = (i: ArrangeItem) => i.section ?? '기타'

/** 묶음 순서대로 펼친 뒤 위치를 0부터 다시 매긴다 */
export function arrange<T extends ArrangeItem>(items: readonly T[], sections: readonly string[]): T[] {
  const out: T[] = []
  for (const s of sections) out.push(...items.filter((i) => sectionOf(i) === s).sort((a, b) => a.position - b.position))
  out.push(...items.filter((i) => !sections.includes(sectionOf(i))))
  return out.map((i, k) => (i.position === k ? i : { ...i, position: k }))
}

/** 한 품목을 다른 묶음 끝으로 */
export function moveToSection<T extends ArrangeItem>(items: readonly T[], id: string, section: string, sections: readonly string[]): T[] {
  const last = Math.max(-1, ...items.filter((i) => sectionOf(i) === section).map((i) => i.position))
  return arrange(items.map((i) => (i.id === id ? { ...i, section, position: last + 0.5 } : i)), sections)
}

/** 한 묶음 안의 새 순서. 다른 묶음은 그대로 */
export function reorderSection<T extends ArrangeItem>(items: readonly T[], section: string, ids: readonly string[], sections: readonly string[]): T[] {
  const rank = new Map(ids.map((id, k) => [id, k]))
  const inSec = items.filter((i) => sectionOf(i) === section)
  const base = Math.min(...inSec.map((i) => i.position))
  return arrange(items.map((i) => (rank.has(i.id) ? { ...i, position: base + (rank.get(i.id) ?? 0) / 1000 } : i)), sections)
}
