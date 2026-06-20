'use client'

import { X, Sparkles } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import type { ChangeType } from '@/lib/changelog/types'
import { CHANGELOG } from '@/lib/changelog/entries'

const TYPE_LABEL: Record<ChangeType, { label: string; bg: string }> = {
  feature: { label: '새 기능', bg: 'var(--success)' },
  fix: { label: '해결', bg: 'var(--info)' },
  improve: { label: '개선', bg: 'var(--warning)' },
}

interface Props {
  currentVersion: string
  onClose: () => void
}

// 'a.b.c' 버전 비교 — 양수면 v1>v2. 표시 정렬·현재버전 판정의 SSOT(수동 정렬 실수 무력화).
function cmpVer(v1: string, v2: string): number {
  const a = v1.split('.').map((n) => parseInt(n, 10) || 0)
  const b = v2.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d !== 0) return d }
  return 0
}

// 버전 클릭 → 사용자향 업데이트 내역 모달. 큐레이션 파일(lib/changelog/entries.ts)을 직접 렌더(배포=게시).
export default function ChangelogModal({ currentVersion, onClose }: Props) {
  useEscClose(onClose)

  // 항상 버전 내림차순으로 표시(파일 작성 순서와 무관하게 일관).
  const notes = [...CHANGELOG].sort((x, y) => cmpVer(y.version, x.version))
  // '현재' 배지: 정확히 일치하는 항목, 없으면 현재 앱버전 이하의 최신 항목(앱버전에 안내 항목이 없을 때 폴백).
  const currentIdx = (() => {
    const exact = notes.findIndex((n) => n.version === currentVersion)
    if (exact >= 0) return exact
    return notes.findIndex((n) => cmpVer(n.version, currentVersion) <= 0)
  })()

  return (
    <div onClick={onClose} className="modal-backdrop">
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="업데이트 내역"
        className="modal-card"
        style={{ width: 'min(560px, 100%)', maxHeight: '80vh' }}
      >
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4) var(--space-5)', borderBottom: 'var(--hairline) solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Sparkles size={18} style={{ color: 'var(--brand)' }} />
            <span className="tape-title" style={{ fontSize: 'var(--fs-lg)' }}>업데이트 내역</span>
          </div>
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 'var(--space-1)' }}>
            <X size={18} />
          </button>
        </div>

        {/* 본문 */}
        <div style={{ overflowY: 'auto', padding: 'var(--space-4) var(--space-5)' }}>
          {notes.length === 0 ? (
            <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)', padding: 'var(--space-6) 0', textAlign: 'center' }}>아직 안내해 드릴 업데이트가 없어요.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              {notes.map((note, idx) => {
                const isCurrent = idx === currentIdx
                return (
                  <div key={note.version} style={{ borderLeft: `var(--border-w-2) solid ${isCurrent ? 'var(--brand)' : 'var(--border-color)'}`, paddingLeft: 'var(--space-3)' }}>
                    {/* 버전 헤더 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-1)' }}>
                      <span style={{ fontWeight: 700, fontSize: 'var(--fs-md)', color: 'var(--text)' }}>v{note.version}</span>
                      {isCurrent && <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: '#fff', background: 'var(--brand)', borderRadius: '9999px', padding: '1px var(--space-2)' }}>현재</span>}
                      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{note.date}</span>
                    </div>
                    {/* 버전 한 줄 요약 */}
                    <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>{note.title}</div>
                    {/* 항목 */}
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                      {note.items.map((it, i) => {
                        const t = TYPE_LABEL[it.kind] ?? TYPE_LABEL.feature
                        return (
                          <li key={`${note.version}-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                            <span aria-hidden style={{ flexShrink: 0, fontSize: 'var(--fs-lg)', lineHeight: 1.2 }}>{it.emoji}</span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                                <span style={{ flexShrink: 0, fontSize: 'var(--fs-2xs)', fontWeight: 700, color: '#fff', background: t.bg, borderRadius: 'var(--radius)', padding: '1px var(--space-1)', minWidth: 36, textAlign: 'center' }}>{t.label}</span>
                                <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>{it.headline}</span>
                              </div>
                              <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>{it.detail}</p>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
