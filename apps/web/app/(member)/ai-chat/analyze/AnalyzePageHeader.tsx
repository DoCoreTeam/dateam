'use client'

import Link from 'next/link'
import { ArrowLeft, ListChecks } from 'lucide-react'

/** 목록 심층분석 — 페이지 헤더(§2-3 표준). AnalyzeClient에서 분리(300줄 유지). */
export default function AnalyzePageHeader() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        flexWrap: 'wrap',
        marginBottom: 'var(--space-6)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <Link
          href="/ai-chat"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            fontSize: 'var(--fs-sm)',
            color: 'var(--text-muted)',
            textDecoration: 'none',
            marginBottom: 'var(--space-2)',
          }}
        >
          <ArrowLeft size={14} />
          AI 채팅으로
        </Link>
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--fs-2xl)',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            color: 'var(--text)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          <ListChecks size={22} color="var(--brand)" />
          목록 심층분석
        </h1>
        <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          자료를 붙여넣거나 파일을 올리면 목록 항목을 전부 추출해 검수 후 항목별로 심층 분석합니다.
        </p>
      </div>
    </div>
  )
}
