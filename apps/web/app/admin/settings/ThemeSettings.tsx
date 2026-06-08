'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { THEMES, type ThemeId } from '@/lib/themes'

export default function ThemeSettings({ initialTheme }: { initialTheme: ThemeId }) {
  const router = useRouter()
  const [theme, setTheme] = useState<ThemeId>(initialTheme)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/settings/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme }),
      })
      const json = await res.json() as { success?: boolean; error?: string }
      if (!res.ok) throw new Error(json.error ?? '저장 실패')
      setMessage({ type: 'success', text: '테마가 적용되었습니다.' })
      router.refresh() // 전역 즉시 반영

    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '저장 중 오류' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        {THEMES.map((t) => {
          const selected = theme === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              data-theme={t.id}
              style={{
                textAlign: 'left',
                padding: '1rem',
                borderRadius: 'var(--radius)',
                border: `var(--border-w) solid ${selected ? 'var(--brand)' : 'var(--border-color)'}`,
                background: 'var(--surface, #fff)',
                boxShadow: selected ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                cursor: 'pointer',
              }}
            >
              {/* 미니 프리뷰 (각 카드에 data-theme 스코프 → 해당 테마 토큰으로 렌더) */}
              <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '0.625rem' }}>
                <span style={{ width: 28, height: 28, borderRadius: 'var(--radius)', background: 'var(--brand)', border: 'var(--border-w) solid var(--border-color)' }} />
                <span style={{ width: 28, height: 28, borderRadius: 'var(--radius)', background: 'var(--accent)', border: 'var(--border-w) solid var(--border-color)' }} />
                <span style={{ width: 28, height: 28, borderRadius: 'var(--radius)', background: 'var(--surface-bg)', border: 'var(--border-w) solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }} />
              </div>
              <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.9375rem' }}>
                {t.label}{selected ? ' ✓' : ''}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{t.desc}</div>
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button type="button" onClick={handleSave} disabled={saving} className="btn-primary" style={{ padding: '0.5rem 1.25rem', fontSize: '0.875rem' }}>
          {saving ? '저장 중...' : '테마 적용'}
        </button>
        {message && (
          <p style={{ fontSize: '0.8125rem', color: message.type === 'success' ? 'var(--success)' : 'var(--danger)' }}>{message.text}</p>
        )}
      </div>
    </div>
  )
}
