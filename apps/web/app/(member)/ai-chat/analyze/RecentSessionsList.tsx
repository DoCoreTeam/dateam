'use client'

import Link from 'next/link'
import { History, ArrowRight } from 'lucide-react'
import type { AnalysisSessionSummary } from './session-list-actions'

interface Props {
  sessions: AnalysisSessionSummary[]
  loading: boolean
  onResume: (id: string) => void
}

// 입력화면은 빠른 재개용 — 최근 소수만 노출해 페이지 스크롤을 밀어내지 않는다.
// 전체 목록/검색·정렬·필터·페이지네이션은 "이전 원문" 탭(?tab=list)이 담당(§C4).
const VISIBLE = 4

/** "이전 분석" 빠른 재개 목록(입력 단계 상단). 최근 VISIBLE개만 + "전체 보기" 링크. */
export default function RecentSessionsList({ sessions, loading, onResume }: Props) {
  if (sessions.length === 0) return null
  const visible = sessions.slice(0, VISIBLE)
  const hasMore = sessions.length > VISIBLE

  return (
    <div className="card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <span className="tape-title" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <History size={14} />
          이전 분석
        </span>
        <Link
          href="/ai-chat/analyze?tab=list"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', textDecoration: 'none', flexShrink: 0 }}
        >
          전체 보기 <ArrowRight size={12} />
        </Link>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {visible.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onResume(s.id)}
              disabled={loading}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius)',
                border: 'var(--hairline) solid var(--border-color)',
                background: 'transparent',
                cursor: loading ? 'default' : 'pointer',
                textAlign: 'left',
                color: 'var(--text)',
                fontSize: 'var(--fs-sm)',
                minHeight: 44,
              }}
            >
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
              <span style={{ flexShrink: 0, fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>
                {s.doneCount}/{s.itemCount}개 완료
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hasMore && (
        <Link
          href="/ai-chat/analyze?tab=list"
          style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)', textDecoration: 'none', textAlign: 'center', padding: 'var(--space-1)' }}
        >
          이전 원문 탭에서 전체 목록·검색 보기
        </Link>
      )}
    </div>
  )
}
