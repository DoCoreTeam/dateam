// 초안 항목(weekly_report_items) → 기존 weekly_reports 행 직렬화 SSOT.
// 왜: 기존 모든 뷰(team/org/취합/적시성)가 weekly_reports(카테고리당 성과/계획/이슈 HTML)를 읽는다.
//     초안 저장 시 "포함" 항목을 이 형식으로 직렬화해 기존 확정본을 갱신하면 하위호환 + Phase2 취합이
//     별도 개조 없이 동작한다(auto·manual 동등 포함 = "자동+수동 기반 동등취합").
import type { DraftItem, DraftSection } from './draft-types.ts'

export interface WeeklyRowSerialized {
  category: string
  performance: string
  plan: string
  issues: string
}

const SECTIONS: readonly DraftSection[] = ['performance', 'plan', 'issues']

/** HTML 특수문자 이스케이프 — 항목 본문(plain/AI 텍스트)을 안전한 HTML로. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 같은 카테고리·섹션의 항목 본문들을 <ul><li> HTML 블록으로. 빈 목록은 ''. */
function itemsToHtml(contents: string[]): string {
  const lis = contents
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => `<li>${escapeHtml(c).replace(/\n/g, '<br>')}</li>`)
  return lis.length > 0 ? `<ul>${lis.join('')}</ul>` : ''
}

/**
 * 포함(is_included)·미삭제 항목만 카테고리별로 묶어 weekly_reports 행 배열로 직렬화.
 * origin(auto/manual) 구분 없이 동등 포함 → "자동+수동 동등취합" 충족.
 * 카테고리 등장 순서를 보존(sortOrder 기준 정렬된 입력 가정).
 */
export function itemsToWeeklyRows(items: DraftItem[]): WeeklyRowSerialized[] {
  const byCategory = new Map<string, Record<DraftSection, string[]>>()
  const order: string[] = []

  for (const it of items) {
    if (!it.isIncluded) continue
    const content = (it.content ?? '').trim()
    if (!content) continue
    const cat = (it.category ?? '').trim() || '기타'
    if (!byCategory.has(cat)) {
      byCategory.set(cat, { performance: [], plan: [], issues: [] })
      order.push(cat)
    }
    byCategory.get(cat)![it.section].push(content)
  }

  return order.map((cat) => {
    const buckets = byCategory.get(cat)!
    const row: WeeklyRowSerialized = { category: cat, performance: '', plan: '', issues: '' }
    for (const sec of SECTIONS) row[sec] = itemsToHtml(buckets[sec])
    return row
  })
}
