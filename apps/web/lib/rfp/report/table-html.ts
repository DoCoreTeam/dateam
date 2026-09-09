/**
 * 표를 다시 표로 (사용자 개입)
 *
 * ## 왜 필요한가
 *
 * 원문 뷰어가 **표 71개를 평문으로 뭉개고 있었다.** 한글 문서의 표는 셀이 탭으로만
 * 구분돼서 한 줄로 흐르고, 그러면 「우편번호 42620 주소 대구광역시…」가 통째로 한 문단이 된다.
 * 사용자가 「이게 문서로 나와 있는 건가」라고 물은 것의 정체다.
 *
 * ## 왜 HTML 을 그대로 안 그리나
 *
 * 우리 파서가 만든 글자라도 화면에 HTML 을 통째로 밀어 넣는 습관을 두지 않는다 —
 * 언젠가 다른 출처의 글이 이 자리로 들어온다. 대신 **모양이 정해진 표만 배열로 푼다.**
 * 푸는 데 실패하면 원문 글자로 떨어진다(빈 표를 그리지 않는다).
 */

/** 한 표에서 읽을 최대 줄·칸 — 넘치면 화면이 표 하나로 가득 찬다 */
export const MAX_ROWS = 200
export const MAX_COLS = 30

export interface ParsedTable {
  rows: string[][]
  /** 첫 줄을 머리글로 볼 수 있나 — 셀이 다 차 있고 두 줄 이상일 때 */
  hasHeader: boolean
}

/**
 * `<table><tr><td>…` 를 배열로.
 *
 * 우리 파서가 내는 모양만 다룬다(속성 없는 table/tr/td). 다른 모양이면 null 이고,
 * 호출부는 원문 글자로 떨어진다 — 억지로 그리면 깨진 표가 남는다.
 */
export function parseSimpleTable(html: string | null | undefined): ParsedTable | null {
  if (!html || !/<table[\s>]/i.test(html)) return null

  const rows: string[][] = []
  const ROW_RE = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  for (let r = ROW_RE.exec(html); r !== null && rows.length < MAX_ROWS; r = ROW_RE.exec(html)) {
    const cells: string[] = []
    const CELL_RE = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
    for (let c = CELL_RE.exec(r[1]); c !== null && cells.length < MAX_COLS; c = CELL_RE.exec(r[1])) {
      cells.push(decodeEntities(c[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    }
    if (cells.length > 0) rows.push(cells)
  }

  if (rows.length === 0) return null
  // 셀이 전부 빈 표는 그리지 않는다 — 빈 격자만 남는다
  if (rows.every((row) => row.every((c) => c === ''))) return null

  const width = Math.max(...rows.map((r) => r.length))
  const padded = rows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill('')])

  return {
    rows: padded,
    // 첫 줄이 다 차 있어야 머리글이다. 비어 있으면 그냥 첫 줄이다
    hasHeader: padded.length > 1 && padded[0].every((c) => c !== ''),
  }
}

const ENTITIES: Record<string, string> = {
  '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
}

function decodeEntities(s: string): string {
  return s.replace(/&(?:lt|gt|amp|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
}

/**
 * 이 표를 표로 그려도 되나.
 *
 * ## 한글 문서의 표는 두 종류다
 *
 * **데이터 표**는 요구사항 총괄표·평가 배점표처럼 칸마다 값이 있다 — 표로 그려야 읽힌다.
 * **레이아웃 표**는 공고문 머리말·서식 틀처럼 **자리를 잡으려고** 쓴 표다.
 * 열이 열 개가 넘고 대부분 비어 있다. 이걸 표로 그리면 좁은 자리에서 열이 1글자 폭이 되고
 * 글자가 세로로 한 자씩 쪼개진다(실측 2026-09-09: 「우/편/번/호」).
 *
 * 그래서 레이아웃 표는 **평문으로 떨어뜨린다** — 원문 그대로 읽는 편이 낫다.
 */
export const MAX_DATA_COLS = 8
export const MAX_EMPTY_RATIO = 0.4

export function looksLikeDataTable(t: ParsedTable): boolean {
  const cols = t.rows[0]?.length ?? 0
  if (cols === 0 || cols > MAX_DATA_COLS) return false
  // 한 줄짜리는 표가 아니라 한 문단이다
  if (t.rows.length < 2) return false

  const cells = t.rows.flat()
  const empty = cells.filter((c) => c === '').length
  return empty / cells.length < MAX_EMPTY_RATIO
}
