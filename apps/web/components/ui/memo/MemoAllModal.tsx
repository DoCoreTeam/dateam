'use client'

import Link from 'next/link'
import { useEscClose } from '@/lib/use-esc-close'
import { X, Check, ArrowUpRight } from 'lucide-react'
import { STALENESS_STYLE, relativeTime, type MemoListItem } from './memoUtils'

interface Props {
  items: MemoListItem[]
  onReview: (id: string) => void
  onPromote: (memo: MemoListItem) => void
  onClose: () => void
}

// "확인 안 한 메모" 전체보기 모달 — 위젯이 이미 로드한 미확인 메모 전체를 스크롤 목록으로 표시.
// 라우팅/뷰 전환에 의존하지 않으므로 홈·일일 어디서든 동일하게 동작한다.
export default function MemoAllModal({ items, onReview, onPromote, onClose }: Props) {
  useEscClose(onClose)

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--modal-backdrop)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="확인 안 한 메모 전체"
        style={{
          width: '100%', maxWidth: 520, background: 'var(--color-surface)',
          borderRadius: 'var(--radius)', padding: 'var(--space-6)', boxShadow: 'var(--shadow-modal)',
          maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h3 className="tape-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            확인 안 한 메모
            <span style={{
              fontSize: '0.7rem', fontWeight: 700, color: 'var(--warning)', background: 'var(--warning-bg)',
              borderRadius: '999px', padding: '1px 8px',
            }}>
              {items.length}
            </span>
          </h3>
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {items.length === 0 ? (
          <div style={{ fontSize: '0.85rem', color: 'var(--text-faint)', padding: 'var(--space-4) var(--space-0)' }}>
            확인 안 한 메모가 없습니다 ✨
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', overflowY: 'auto' }}>
            {items.map((m) => {
              const st = STALENESS_STYLE[m.staleness]
              return (
                <li
                  key={m.id}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
                    padding: '0.6rem 0.7rem', borderRadius: 'var(--radius)',
                    background: 'var(--color-bg)', border: 'var(--hairline) solid var(--surface-muted)',
                  }}
                >
                  <span title={st.label} style={{ width: 8, height: 8, borderRadius: '50%', background: st.dot, flexShrink: 0, marginTop: '0.35rem' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
                      {m.content}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: st.text, marginTop: '0.15rem' }}>{relativeTime(m.logged_at)}</div>
                  </div>
                  <button
                    onClick={() => onReview(m.id)}
                    title="확인 완료"
                    aria-label="확인 완료"
                    style={{ background: 'none', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', padding: '4px 6px', color: 'var(--success)', display: 'flex', flexShrink: 0 }}
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={() => onPromote(m)}
                    title="업무로 전환"
                    aria-label="업무로 전환"
                    style={{ background: 'none', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', padding: '4px 6px', color: 'var(--brand-dark)', display: 'flex', flexShrink: 0 }}
                  >
                    <ArrowUpRight size={14} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: 'var(--hairline) solid var(--surface-muted)', display: 'flex', justifyContent: 'flex-end' }}>
          <Link
            href="/daily?view=memo"
            onClick={onClose}
            style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--brand-dark)', textDecoration: 'none' }}
          >
            메모 탭에서 전체 관리 →
          </Link>
        </div>
      </div>
    </div>
  )
}
