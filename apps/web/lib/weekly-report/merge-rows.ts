/**
 * 주간보고 행 병합 SSOT.
 *
 * "일일업무에서 주간보고 생성" 등 생성 결과를 폼의 기존 행과 합칠 때,
 * 기존 내용(이월 성과·저장본·수동입력)을 보존하면서 카테고리 단위로 병합한다.
 *
 * 정책:
 * - 생성 카테고리가 기존에 없으면 → 새 행 추가
 * - 생성 카테고리가 기존에 있으면 → 셀(성과/계획/이슈)별 <li> 항목 합집합(기존 우선, 중복 제거)
 * - 빈 셀은 상대 값으로 채움
 *
 * 셀 값은 리치텍스트 HTML(`<ul><li>…</li></ul>` 또는 `<p>…</p>`).
 */

export interface WeeklyRow {
  category: string
  performance: string
  plan: string
  issues: string
}

const CELL_FIELDS: Array<keyof Omit<WeeklyRow, 'category'>> = ['performance', 'plan', 'issues']

const EMPTY_ROW: WeeklyRow = { category: '', performance: '', plan: '', issues: '' }

/** 빈 HTML 셀 판정 — actions.ts/refine route의 skip 조건과 동일 의미. */
export function isEmptyCell(html: string): boolean {
  if (!html) return true
  const t = html.trim()
  return t === '' || t === '<p></p>' || t === '<p><br></p>' || t === '-' || stripTags(t) === ''
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 중복 비교용 정규화 키(태그 제거 + 소문자 + 공백 축약). */
function dedupKey(itemHtml: string): string {
  return stripTags(itemHtml).toLowerCase()
}

/**
 * 셀 HTML을 항목(<li> 내부 HTML) 배열로 분해한다.
 * - <li>가 있으면 각 <li> 내부 HTML을 항목으로.
 * - <li>가 없으면 <p>/<br> 기준으로 블록을 나눠 항목으로(수동 입력 보존).
 */
export function extractItems(html: string): string[] {
  if (isEmptyCell(html)) return []

  const liMatches = Array.from(html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi))
    .map((m) => m[1].trim())
    .filter((s) => stripTags(s) !== '')
  if (liMatches.length > 0) return liMatches

  // <li>가 없는 경우(예: 수동 <p> 단락) — 블록 단위로 분해
  const blocks = html
    .replace(/<\/(p|div|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:p|div|h[1-6]|ul|ol)[^>]*>/gi, '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => stripTags(s) !== '')
  return blocks.length > 0 ? blocks : []
}

/** 항목 배열을 `<ul><li>…</li></ul>` HTML로 렌더. 비면 ''. */
function renderItems(items: string[]): string {
  if (items.length === 0) return ''
  return `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
}

/**
 * 두 셀을 병합한다. 기존 항목을 앞에 두고, 신규 항목 중 중복(정규화 텍스트 일치)이 아닌 것만 뒤에 추가.
 * 한쪽이 비면 다른 쪽 원본을 그대로 반환(불필요한 재렌더 방지).
 */
export function mergeCell(existing: string, incoming: string): string {
  if (isEmptyCell(incoming)) return existing
  if (isEmptyCell(existing)) return incoming

  const seen = new Set<string>()
  const merged: string[] = []
  for (const item of [...extractItems(existing), ...extractItems(incoming)]) {
    const key = dedupKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return renderItems(merged)
}

/** 카테고리/내용이 모두 빈 placeholder 행 여부. */
function isBlankRow(row: WeeklyRow): boolean {
  return !row.category.trim() && CELL_FIELDS.every((f) => isEmptyCell(row[f]))
}

function categoryKey(category: string): string {
  return category.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * 생성된 행들을 기존 행들에 병합한다.
 *
 * @param existing 폼의 현재 rows
 * @param generated 생성(일일업무→주간보고) 결과 rows
 * @returns 병합된 rows (최소 1개 행 보장)
 */
export function mergeWeeklyRows(existing: WeeklyRow[], generated: WeeklyRow[]): WeeklyRow[] {
  // 빈 placeholder 행은 병합 기준에서 제외
  const base = existing.filter((r) => !isBlankRow(r)).map((r) => ({ ...r }))

  if (generated.length === 0) {
    return base.length > 0 ? base : [{ ...EMPTY_ROW }]
  }

  // 카테고리 키 → base 인덱스
  const indexByKey = new Map<string, number>()
  base.forEach((r, i) => {
    const key = categoryKey(r.category)
    if (key && !indexByKey.has(key)) indexByKey.set(key, i)
  })

  for (const gen of generated) {
    const key = categoryKey(gen.category)
    const targetIdx = key ? indexByKey.get(key) : undefined

    if (targetIdx === undefined) {
      base.push({ ...gen })
      if (key) indexByKey.set(key, base.length - 1)
      continue
    }

    const target = base[targetIdx]
    base[targetIdx] = {
      ...target,
      performance: mergeCell(target.performance, gen.performance),
      plan: mergeCell(target.plan, gen.plan),
      issues: mergeCell(target.issues, gen.issues),
    }
  }

  return base.length > 0 ? base : [{ ...EMPTY_ROW }]
}
