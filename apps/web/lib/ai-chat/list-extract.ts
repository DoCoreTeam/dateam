// 목록 심층분석 — 구조 파싱 + 병합 SSOT (순수 함수, 단위테스트 대상).
// 핵심 계약: 무손실. parseListItems가 구조적으로 잡은 항목은 mergeExtractedItems를 거쳐도
// 반드시 최종 결과에 살아남는다(AI 보정은 "추가"만 하고 "축소"하지 않는다).
// 항목 텍스트는 어떤 단계에서도 잘라내지(truncate) 않는다 — 원문 그대로 보존.

export interface ExtractedListItem {
  text: string
  marker: string
}

// 코드블록(```...```)은 목록 추출 대상에서 제외 — 코드 내 주석기호가 목록으로 오검출되는 것 방지.
const CODE_FENCE_RE = /```[\s\S]*?```/g

// 줄 단위 목록 마커 패턴 — 순서가 우선순위(먼저 매치되는 패턴 채택).
// 1. / 1) · ① ~ ⑳ · 가./나) 같은 한글 순번 · -,*,• 기호.
const LIST_LINE_PATTERNS: RegExp[] = [
  /^\s*(\d{1,4})[.)]\s+(.+)$/,
  /^\s*([①-⑳])\s*(.+)$/,
  /^\s*([가-힣])[.)]\s+(.+)$/,
  /^\s*([-*•])\s+(.+)$/,
]

/**
 * 자유 텍스트에서 번호·기호로 시작하는 목록 줄을 전부 추출한다(1차 구조 파싱).
 * 코드블록 내부는 제외. 항목 텍스트는 원문 그대로(trim만) — 축약·절단 없음.
 */
export function parseListItems(text: string): ExtractedListItem[] {
  if (!text || !text.trim()) return []
  const withoutCode = text.replace(CODE_FENCE_RE, '')
  const lines = withoutCode.split('\n')
  const items: ExtractedListItem[] = []

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '')
    if (!line.trim()) continue
    for (const re of LIST_LINE_PATTERNS) {
      const m = line.match(re)
      if (!m) continue
      const marker = m[1]
      const itemText = m[2].trim()
      if (itemText) items.push({ text: itemText, marker })
      break
    }
  }
  return items
}

/** 병합용 정규화 키 — 공백 정리 + 소문자화. "완전 동일" 판정에만 사용(내용 변형 아님). */
function normalizeItemKey(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

export interface MergedItem {
  text: string
  /** true = AI 보정이 놓쳐 1차 구조 파싱에서 원문 그대로 복구된 항목(완전성 검증용 강조 대상). */
  recovered: boolean
}

export interface MergeResult {
  items: MergedItem[]
  /** parsed 개수 — 완전성 배지("구조 파싱 N개") 근거. */
  parsedCount: number
  /** AI가 놓쳐 원문 그대로 복구된 항목 수 — 0 초과면 "확인 필요" 경고 배지 표시. */
  restoredCount: number
}

/**
 * 1차 구조 파싱 결과(parsed)와 AI 보정 결과(aiTexts)를 병합한다.
 * 계약(유실0): parsed의 모든 항목은 최종 결과에 반드시 포함된다.
 * - AI 결과를 우선 순서로 채택하되, 완전 동일(정규화 키 일치) 항목만 중복 제거.
 * - AI가 놓친 parsed 항목은 원문 그대로 뒤에 복구(recovered:true로 표시 — UI가 강조).
 * - 애매한 경우(다른 표현이지만 비슷함)는 병합하지 않고 둘 다 남긴다.
 */
export function mergeExtractedItems(parsed: ExtractedListItem[], aiTexts: string[]): MergeResult {
  const merged: MergedItem[] = []
  const seenKeys = new Set<string>()

  for (const raw of aiTexts) {
    const t = raw.trim()
    if (!t) continue
    const key = normalizeItemKey(t)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    merged.push({ text: t, recovered: false })
  }

  let restoredCount = 0
  for (const p of parsed) {
    const key = normalizeItemKey(p.text)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    merged.push({ text: p.text, recovered: true })
    restoredCount += 1
  }

  return { items: merged, parsedCount: parsed.length, restoredCount }
}

// ── 업로드 소스 → 처리 방식 디스패치 (순수 분류 함수) ──
export type SourceMethod = 'text' | 'office' | 'pdf' | 'html' | 'image'

const TEXT_MIMES = ['text/plain', 'text/markdown', 'text/csv', 'application/json']
const OFFICE_MIMES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
]
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp']
const PDF_MIME = 'application/pdf'
const HTML_MIMES = ['text/html']

const TEXT_EXTS = ['md', 'txt', 'csv', 'json']
const OFFICE_EXTS = ['docx', 'xlsx', 'pptx']
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp']
const HTML_EXTS = ['html', 'htm']

function extOf(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx >= 0 ? filename.slice(idx + 1).toLowerCase() : ''
}

/**
 * 업로드 파일의 mime(1순위)·확장자(폴백)로 처리 방식을 판정한다.
 * 브라우저가 mime을 빈 값/application/octet-stream으로 줄 때 확장자로 보정.
 */
export function classifySourceMime(mime: string, filename: string): SourceMethod | null {
  const lower = (mime || '').toLowerCase().trim()
  if (IMAGE_MIMES.includes(lower)) return 'image'
  if (lower === PDF_MIME) return 'pdf'
  if (OFFICE_MIMES.includes(lower)) return 'office'
  if (HTML_MIMES.includes(lower)) return 'html'
  if (TEXT_MIMES.includes(lower)) return 'text'

  const ext = extOf(filename)
  if (IMAGE_EXTS.includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (OFFICE_EXTS.includes(ext)) return 'office'
  if (HTML_EXTS.includes(ext)) return 'html'
  if (TEXT_EXTS.includes(ext)) return 'text'
  return null
}
