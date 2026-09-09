'use client'

// 세션 3 §4-3 — web_search 출처 카드. 메시지 하단 출처 칩 목록.
// 외부 favicon 요청은 하지 않는다(내부 어드민 도구 — 브라우징 누출 회피): 도메인 텍스트 + 제네릭 아이콘.
// 순수 프레젠테이션 — citations 저장/복원은 허브가 담당.

import { Globe } from 'lucide-react'
import type { AiChatCitation } from '@/types/database'

interface Props {
  citations: AiChatCitation[]
}

/** URL → 표시용 도메인(www. 제거). 파싱 실패 시 원문 일부. */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || url
  }
}

export default function CitationCards({ citations }: Props) {
  if (!citations || citations.length === 0) return null
  return (
    <div className="citation-cards" role="list" aria-label="출처">
      {citations.map((c, i) => (
        <a
          key={`${c.url}-${i}`}
          className="citation-card"
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          role="listitem"
          title={c.title || c.url}
        >
          <span className="citation-card-idx" aria-hidden="true">
            {i + 1}
          </span>
          <span className="citation-card-body">
            <span className="citation-card-title">{c.title || domainOf(c.url)}</span>
            <span className="citation-card-domain">
              <Globe size={11} aria-hidden="true" />
              {domainOf(c.url)}
            </span>
          </span>
        </a>
      ))}
    </div>
  )
}
