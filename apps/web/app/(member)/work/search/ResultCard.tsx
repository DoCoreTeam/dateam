// 통합 검색 결과 카드 — type 뱃지 + 제목 + 매칭 강조 스니펫 + 날짜. 클릭 시 href 이동.
// 강조는 dangerouslySetInnerHTML 없이 문자열 분할 + <mark> 엘리먼트로 안전 렌더.
import Link from 'next/link'
import type { ReactNode } from 'react'
import { SEARCH_TYPE_META, type WorkSearchResult } from './search-types'

/** plain text를 q 기준으로 분할해 매칭 부분만 <mark>로 강조(대소문자 무시, XSS 안전) */
function highlight(text: string, q: string): ReactNode {
  const query = q.trim()
  if (!query) return text
  const lower = text.toLowerCase()
  const qLower = query.toLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  let idx = lower.indexOf(qLower, cursor)
  let key = 0
  while (idx >= 0) {
    if (idx > cursor) parts.push(text.slice(cursor, idx))
    parts.push(<mark key={key++}>{text.slice(idx, idx + query.length)}</mark>)
    cursor = idx + query.length
    idx = lower.indexOf(qLower, cursor)
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

function formatDate(raw: string): string {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

interface ResultCardProps {
  result: WorkSearchResult
  query: string
}

export default function ResultCard({ result, query }: ResultCardProps) {
  const meta = SEARCH_TYPE_META[result.type]
  return (
    <Link
      href={result.href}
      className="work-search-result"
      style={{ borderLeftColor: meta.color }}
    >
      <div className="work-search-result-head">
        <span className="work-search-type" style={{ color: meta.color }}>
          {meta.label}
        </span>
        <time className="work-search-date" dateTime={result.date}>
          {formatDate(result.date)}
        </time>
      </div>
      <h2 className="work-search-title">{highlight(result.title, query)}</h2>
      {result.snippet && (
        <p className="work-search-snippet">{highlight(result.snippet, query)}</p>
      )}
    </Link>
  )
}
