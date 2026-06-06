'use client'
import { useEscClose } from '@/lib/use-esc-close'

import { useState } from 'react'

export interface DiffItem {
  category: string
  field: 'performance' | 'plan' | 'issues'
  original: string
  refined: string
  accepted: boolean
}

const FIELD_LABELS: Record<DiffItem['field'], string> = {
  performance: '성과',
  plan: '계획',
  issues: '이슈/협조사항',
}

interface DiffConfirmModalProps {
  items: DiffItem[]
  onConfirm: (items: DiffItem[]) => void
  onCancel: () => void
}

function RichPreview({ html }: { html: string }) {
  const empty = !html || html === '<p></p>' || html === '<p><br></p>' || html.trim() === ''
  if (empty) return <span style={{ color: '#cbd5e1', fontSize: '0.8rem' }}>비어있음</span>
  if (html.startsWith('<')) {
    return (
      <div
        className="report-rich"
        style={{ fontSize: '0.8rem', pointerEvents: 'none', userSelect: 'none' }}
        // HTML from Tiptap (user-authored) or Gemini refine (same user session)
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }
  return <p style={{ margin: 0, fontSize: '0.8rem', color: '#374151', lineHeight: 1.5 }}>{html}</p>
}

export default function DiffConfirmModal({ items, onConfirm, onCancel }: DiffConfirmModalProps) {
  useEscClose(onCancel)
  const [localItems, setLocalItems] = useState<DiffItem[]>(items)

  const toggle = (idx: number) =>
    setLocalItems((prev) => prev.map((item, i) => (i === idx ? { ...item, accepted: !item.accepted } : item)))

  const acceptAll = () => setLocalItems((prev) => prev.map((item) => ({ ...item, accepted: true })))
  const rejectAll = () => setLocalItems((prev) => prev.map((item) => ({ ...item, accepted: false })))

  const acceptedCount = localItems.filter((i) => i.accepted).length

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI로 다듬기 결과 확인"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 'var(--radius)',
        width: 'min(720px, calc(100vw - 2rem))',
        maxHeight: 'calc(100vh - 4rem)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem', borderBottom: '2px solid var(--border-color)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          background: 'linear-gradient(to right, #faf5ff, #fdf4ff)',
        }}>
          <div>
            <h2 className="tape-title" style={{ margin: 0 }}>
              ✨ AI로 다듬기 결과 확인
            </h2>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
              변경된 {localItems.length}개 항목을 확인하고 적용할 내용을 선택하세요
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="닫기"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.375rem', lineHeight: 1, padding: '0.125rem' }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '1rem 1.5rem' }}>
          {localItems.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem 0', fontSize: '0.875rem' }}>
              변경된 항목이 없습니다
            </p>
          ) : (
            localItems.map((item, idx) => (
              <div
                key={idx}
                style={{
                  marginBottom: '0.75rem',
                  border: item.accepted ? '1px solid #ddd6fe' : '2px solid var(--border-color)',
                  borderRadius: 'var(--radius)',
                  overflow: 'hidden',
                  background: item.accepted ? '#faf5ff' : 'var(--color-bg)',
                  transition: 'all 150ms',
                }}
              >
                {/* Row header */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.5rem 0.875rem',
                  borderBottom: '2px solid var(--border-color)',
                  background: item.accepted ? '#f3eeff' : '#f1f5f9',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1e1b4b' }}>{item.category}</span>
                    <span style={{
                      fontSize: '0.7rem', padding: '0.1rem 0.4rem',
                      background: '#ede9fe', color: '#3730a3', borderRadius: '999px', fontWeight: 600,
                    }}>
                      {FIELD_LABELS[item.field]}
                    </span>
                  </div>
                  <button
                    onClick={() => toggle(idx)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                      padding: '0.25rem 0.625rem',
                      background: item.accepted ? '#7c3aed' : 'var(--color-border)',
                      color: item.accepted ? '#fff' : '#64748b',
                      border: 'none', borderRadius: '999px', cursor: 'pointer',
                      fontSize: '0.75rem', fontWeight: 600, transition: 'all 150ms',
                    }}
                  >
                    {item.accepted ? '✓ 적용' : '○ 유지'}
                  </button>
                </div>

                {/* Diff columns */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <div style={{ padding: '0.75rem 0.875rem', borderRight: '2px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.375rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      원본
                    </div>
                    <RichPreview html={item.original} />
                  </div>
                  <div style={{ padding: '0.75rem 0.875rem', background: item.accepted ? '#f5f3ff' : 'transparent' }}>
                    <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: item.accepted ? '#7c3aed' : '#94a3b8', marginBottom: '0.375rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      다듬어진 내용
                    </div>
                    <RichPreview html={item.refined} />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.875rem 1.5rem', borderTop: '2px solid var(--border-color)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem',
          background: 'var(--color-bg)',
        }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={acceptAll}
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.8125rem', color: '#7c3aed', background: '#ede9fe', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontWeight: 600 }}
            >
              전체 수락
            </button>
            <button
              onClick={rejectAll}
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.8125rem', color: '#64748b', background: '#f1f5f9', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontWeight: 600 }}
            >
              전체 거절
            </button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{acceptedCount}/{localItems.length} 적용</span>
            <button
              onClick={onCancel}
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.8125rem', color: '#64748b', background: '#fff', border: '2px solid var(--border-color)', borderRadius: '0.375rem', cursor: 'pointer' }}
            >
              취소
            </button>
            <button
              onClick={() => onConfirm(localItems)}
              style={{
                padding: '0.375rem 1rem', fontSize: '0.8125rem', fontWeight: 600,
                color: '#fff',
                background: acceptedCount > 0 ? '#7c3aed' : '#cbd5e1',
                border: 'none', borderRadius: '0.375rem',
                cursor: acceptedCount > 0 ? 'pointer' : 'not-allowed',
              }}
            >
              확정 적용 ({acceptedCount})
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
