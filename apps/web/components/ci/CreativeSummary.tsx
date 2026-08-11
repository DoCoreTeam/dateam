'use client'

// components/ci/CreativeSummary.tsx — "왜 터졌나" 표시 (전 화면 공용)
//
// 같은 값을 카드와 상세 시트가 각자 포맷하면 곧 갈라진다.
// 카드는 compact(후킹 유형·썸네일 문구 한 줄), 상세는 full(항목 전부).

import type { ReactNode } from 'react'
import type { CiCreativeInfo } from '@/lib/ci/contracts'

interface Props {
  creative: CiCreativeInfo | null | undefined
  variant?: 'compact' | 'full'
}

/** 규칙만으로 낸 결과를 AI가 썸네일을 읽은 것처럼 보이게 하지 않는다. */
function sourceLabel(source: CiCreativeInfo['source']): string {
  return source === 'ai' ? '썸네일 판독' : '제목 규칙'
}

export default function CreativeSummary({ creative, variant = 'full' }: Props) {
  if (!creative) return null

  if (variant === 'compact') {
    const chips = [
      creative.hookType,
      ...creative.titlePattern.slice(0, 2),
    ].filter((v): v is string => Boolean(v))

    if (chips.length === 0 && !creative.thumbnailText) return null

    return (
      <div className="ci-creative-compact">
        {creative.thumbnailText && (
          <p className="ci-creative-thumbtext" title={creative.thumbnailText}>
            썸네일 “{creative.thumbnailText}”
          </p>
        )}
        {chips.length > 0 && (
          <div className="ci-card-badges">
            {chips.map((c) => (
              <span key={c} className="ci-status ci-status-info">{c}</span>
            ))}
          </div>
        )}
      </div>
    )
  }

  const rows: { label: string; value: ReactNode }[] = [
    {
      label: '썸네일 문구',
      value: creative.thumbnailText
        ? <span className="ci-creative-quote">“{creative.thumbnailText}”</span>
        : '읽어낸 글자 없음',
    },
    {
      label: '썸네일 구성',
      value: creative.thumbnailStyle.length
        ? creative.thumbnailStyle.join(' · ')
        : '—',
    },
    {
      label: '썸네일 설명',
      value: creative.thumbnailSummary ?? '—',
    },
    {
      label: '후킹 메시지',
      value: creative.hookMessage
        ? <span className="ci-creative-quote">“{creative.hookMessage}”</span>
        : '—',
    },
    {
      label: '후킹 유형',
      value: creative.hookType
        ? <span className="ci-status ci-status-info">{creative.hookType}</span>
        : '—',
    },
    {
      label: '제목 패턴',
      value: creative.titlePattern.length
        ? (
          <span className="ci-card-badges">
            {creative.titlePattern.map((t) => (
              <span key={t} className="ci-status ci-status-neutral">{t}</span>
            ))}
          </span>
        )
        : '—',
    },
  ]

  return (
    <section className="ci-creative">
      <h4 className="ci-creative-head">무엇이 통했나</h4>
      <dl className="ci-creative-grid">
        {rows.map((r) => (
          <div key={r.label} className="ci-creative-row">
            <dt className="ci-basis">{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="ci-basis">
        {sourceLabel(creative.source)}
        {creative.analyzedAtText ? ` · ${creative.analyzedAtText}` : ''}
        {creative.note ? ` · ${creative.note}` : ''}
      </p>
    </section>
  )
}
