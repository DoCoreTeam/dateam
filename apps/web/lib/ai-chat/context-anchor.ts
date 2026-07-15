// 목록 심층분석 v2 — 맥락 앵커 SSOT (순수 함수, 단위테스트 대상).
// 각 항목 텍스트를 원문(source_text)에서 찾아 그 항목을 감싸는 원문 구간(span)을 결정한다.
// AI 호출 없음 — 전부 결정론적 문자열 연산. 이미지/OCR 소스처럼 원문에서 못 찾으면 null.

export interface AnchorSpan {
  start: number
  end: number
  excerpt: string
}

interface AnchorOptions {
  maxExcerpt?: number
}

const DEFAULT_MAX_EXCERPT = 1200
// 정확 일치 실패 시 부분일치 폴백에 쓰는 선행 구간 길이.
const FALLBACK_PREFIX_LEN = 40
// 마크다운 헤딩 줄(# ~ ######, 뒤에 공백/탭 1개 이상) — 감싸는 구간의 경계로 취급.
const HEADING_LINE_RE = /^#{1,6}[ \t]/gm

interface MatchRange {
  start: number
  end: number
}

/**
 * itemText를 sourceText에서 찾는다.
 * 1차: 정확 일치(indexOf). 실패 시 항목 선행 부분(FALLBACK_PREFIX_LEN자)으로 부분일치 재시도.
 */
function findMatch(sourceText: string, itemText: string): MatchRange | null {
  if (!itemText) return null

  const exactIdx = sourceText.indexOf(itemText)
  if (exactIdx !== -1) {
    return { start: exactIdx, end: exactIdx + itemText.length }
  }

  const prefix = itemText.slice(0, FALLBACK_PREFIX_LEN).trim()
  if (!prefix) return null

  const partialIdx = sourceText.indexOf(prefix)
  if (partialIdx !== -1) {
    return { start: partialIdx, end: partialIdx + prefix.length }
  }

  return null
}

/** pos가 속한 줄의 시작 오프셋. */
function lineStart(text: string, pos: number): number {
  const idx = text.lastIndexOf('\n', Math.max(pos - 1, 0))
  return idx === -1 ? 0 : idx + 1
}

/** pos가 속한 줄의 끝 오프셋(개행 문자 직전, exclusive). */
function lineEnd(text: string, pos: number): number {
  const idx = text.indexOf('\n', pos)
  return idx === -1 ? text.length : idx
}

/** text 전체에서 마크다운 헤딩 줄의 시작 오프셋 목록(오름차순). */
function collectHeadingStarts(text: string): number[] {
  const starts: number[] = []
  // 정규식 객체를 매 호출마다 새로 만들어 lastIndex 상태 공유(스레드 세이프 오작동)를 방지.
  const re = new RegExp(HEADING_LINE_RE.source, HEADING_LINE_RE.flags)
  let m: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(text)) !== null) {
    starts.push(m.index)
  }
  return starts
}

/**
 * matchStart 왼쪽으로 확장 가능한 경계(포함 시작 오프셋)를 계산.
 * 후보: 직전 빈 줄(\n\n) 다음 위치, 직전 헤딩 줄 다음 위치. 매치에 더 가까운(큰) 쪽을 채택.
 */
function findLeftBoundary(sourceText: string, matchStart: number, headingStarts: number[]): number {
  let boundary = 0

  const blankIdx = sourceText.lastIndexOf('\n\n', Math.max(matchStart - 1, 0))
  if (blankIdx !== -1) {
    boundary = Math.max(boundary, blankIdx + 2)
  }

  for (const headingStart of headingStarts) {
    if (headingStart > matchStart) break
    const afterHeading = lineEnd(sourceText, headingStart) + 1
    const candidate = Math.min(afterHeading, matchStart)
    if (candidate > boundary) boundary = candidate
  }

  return Math.min(boundary, matchStart)
}

/**
 * matchEnd 오른쪽으로 확장 가능한 경계(exclusive 끝 오프셋)를 계산.
 * 후보: 다음 빈 줄(\n\n) 시작 위치, 다음 헤딩 줄 시작 위치. 매치에 더 가까운(작은) 쪽을 채택.
 */
function findRightBoundary(sourceText: string, matchEnd: number, headingStarts: number[]): number {
  let boundary = sourceText.length

  const blankIdx = sourceText.indexOf('\n\n', matchEnd)
  if (blankIdx !== -1) {
    boundary = Math.min(boundary, blankIdx)
  }

  for (const headingStart of headingStarts) {
    if (headingStart < matchEnd) continue
    boundary = Math.min(boundary, headingStart)
    break
  }

  return Math.max(boundary, matchEnd)
}

/** [left, right) 구간이 maxExcerpt를 넘으면 match를 포함한 채 좌우를 비례 축소. */
function clampToMaxExcerpt(
  left: number,
  right: number,
  matchStart: number,
  matchEnd: number,
  maxExcerpt: number
): { left: number; right: number } {
  const total = right - left
  if (total <= maxExcerpt) return { left, right }

  const matchLen = matchEnd - matchStart
  if (matchLen >= maxExcerpt) {
    // 매치 자체가 상한을 넘으면 매치 시작부터 상한만큼만.
    return { left: matchStart, right: matchStart + maxExcerpt }
  }

  const leftSpace = matchStart - left
  const rightSpace = right - matchEnd
  const spaceTotal = leftSpace + rightSpace
  const excess = total - maxExcerpt

  if (spaceTotal <= 0) {
    return { left: matchStart, right: matchEnd }
  }

  const cutLeft = Math.round((excess * leftSpace) / spaceTotal)
  const cutRight = excess - cutLeft

  return {
    left: left + cutLeft,
    right: right - cutRight,
  }
}

/**
 * itemText를 sourceText에서 찾아 감싸는 문단/섹션 구간을 앵커링.
 * - 1차: 정확 일치(indexOf). 실패 시 항목 앞부분(선행 40자 등) 부분일치 폴백.
 * - 감싸는 구간 = 매치 위치에서 앞뒤로 빈 줄(\n\n) 경계 또는 다음 마크다운 헤딩(^#{1,6} )까지 확장. maxExcerpt로 상한.
 * - 못 찾으면 null(이미지/OCR 소스).
 */
export function anchorItem(
  sourceText: string,
  itemText: string,
  opts?: AnchorOptions
): AnchorSpan | null {
  if (!sourceText) return null

  const match = findMatch(sourceText, itemText)
  if (!match) return null

  const maxExcerpt = opts?.maxExcerpt ?? DEFAULT_MAX_EXCERPT
  const headingStarts = collectHeadingStarts(sourceText)

  const rawLeft = findLeftBoundary(sourceText, match.start, headingStarts)
  const rawRight = findRightBoundary(sourceText, match.end, headingStarts)

  const { left, right } = clampToMaxExcerpt(rawLeft, rawRight, match.start, match.end, maxExcerpt)

  return {
    start: match.start,
    end: match.end,
    excerpt: sourceText.slice(left, right),
  }
}
