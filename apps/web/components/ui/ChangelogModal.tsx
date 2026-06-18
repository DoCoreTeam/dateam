'use client'

import { useEffect, useState } from 'react'
import { X, Sparkles } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import type { Release, ChangeType } from '@/lib/changelog/types'

const TYPE_LABEL: Record<ChangeType, { label: string; bg: string }> = {
  feature: { label: '기능', bg: 'var(--success)' },
  fix: { label: '수정', bg: 'var(--info)' },
  improve: { label: '개선', bg: 'var(--warning)' },
}

interface Props {
  currentVersion: string
  onClose: () => void
}

// 버전 클릭 → 게시된 업데이트 내역 모달. /api/changelog(게시분) 조회.
export default function ChangelogModal({ currentVersion, onClose }: Props) {
  useEscClose(onClose)
  const [releases, setReleases] = useState<Release[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/changelog')
      .then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) }))
      .then(({ ok, j }) => { if (!alive) return; if (!ok) setError(j.error ?? '업데이트 내역을 불러오지 못했습니다'); else setReleases(j.releases ?? []) })
      .catch(() => { if (alive) setError('업데이트 내역을 불러오지 못했습니다') })
    return () => { alive = false }
  }, [])

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
          {error ? (
            <div style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)', padding: 'var(--space-4) 0' }}>✕ {error}</div>
          ) : releases === null ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', padding: 'var(--space-6) 0', textAlign: 'center' }}>불러오는 중…</div>
          ) : releases.length === 0 ? (
            <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)', padding: 'var(--space-6) 0', textAlign: 'center' }}>아직 게시된 업데이트 내역이 없습니다.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {releases.map((r) => {
                const isCurrent = r.version === currentVersion
                return (
                  <div key={r.version} style={{ borderLeft: `var(--border-w-2) solid ${isCurrent ? 'var(--brand)' : 'var(--border-color)'}`, paddingLeft: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-1)' }}>
                      <span style={{ fontWeight: 700, fontSize: 'var(--fs-md)', color: 'var(--text)' }}>v{r.version}</span>
                      {isCurrent && <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: '#fff', background: 'var(--brand)', borderRadius: '9999px', padding: '1px var(--space-2)' }}>현재</span>}
                      {r.released_at && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{r.released_at}</span>}
                    </div>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                      {(r.changes ?? []).map((c, i) => {
                        const t = TYPE_LABEL[c.type] ?? TYPE_LABEL.feature
                        return (
                          <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                            <span style={{ flexShrink: 0, fontSize: 'var(--fs-2xs)', fontWeight: 700, color: '#fff', background: t.bg, borderRadius: 'var(--radius)', padding: '1px var(--space-1)', minWidth: 28, textAlign: 'center' }}>{t.label}</span>
                            <span>{c.text}</span>
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
