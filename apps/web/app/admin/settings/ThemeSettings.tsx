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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
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
                padding: 'var(--space-4)',
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
              <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 'var(--fs-md)' }}>
                {t.label}
                {t.id === initialTheme && (
                  <span style={{ marginLeft: '0.375rem', fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--brand)' }}>(디폴트)</span>
                )}
                {selected ? ' ✓' : ''}
              </div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{t.desc}</div>
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <button type="button" onClick={handleSave} disabled={saving} className="btn-primary" style={{ padding: 'var(--space-2) var(--space-5)', fontSize: 'var(--fs-base)' }}>
          {saving ? '저장 중...' : '테마 적용'}
        </button>
        {message && (
          <p style={{ fontSize: 'var(--fs-sm)', color: message.type === 'success' ? 'var(--success)' : 'var(--danger)' }}>{message.text}</p>
        )}
      </div>
    </div>
  )
}
