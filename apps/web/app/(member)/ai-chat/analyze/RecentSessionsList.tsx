'use client'

import { History } from 'lucide-react'
import type { AnalysisSessionSummary } from './session-actions'

interface Props {
  sessions: AnalysisSessionSummary[]
  loading: boolean
  onResume: (id: string) => void
}

/** "이전 분석" 빠른 재개 목록(입력 단계 상단). 전체 목록/검색·정렬·필터는 별도 세션 목록 화면(§C4)이 담당. */
export default function RecentSessionsList({ sessions, loading, onResume }: Props) {
  if (sessions.length === 0) return null

  return (
    <div className="card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <span className="tape-title" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
        <History size={14} />
        이전 분석
      </span>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {sessions.map((s) => (
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
    </div>
  )
}
