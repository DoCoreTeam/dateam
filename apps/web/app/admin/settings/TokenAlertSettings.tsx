'use client'

import { useState, useTransition } from 'react'
import { Bell } from 'lucide-react'
import { saveTokenAlertThreshold } from './actions'

interface Props {
  currentThreshold: number
}

export default function TokenAlertSettings({ currentThreshold }: Props) {
  const [threshold, setThreshold] = useState(currentThreshold.toLocaleString('ko-KR'))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    const fd = new FormData()
    fd.set('threshold', threshold)
    start(async () => {
      const result = await saveTokenAlertThreshold(fd)
      setMsg({ ok: result.ok, text: result.ok ? '임계치가 저장되었습니다' : (result.error ?? '저장 실패') })
    })
  }

  return (
    <div className="card" style={{ padding: '1.5rem', maxWidth: '640px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <Bell size={16} color="var(--brand)" />
        <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>AI 토큰 알림 임계치</h2>
      </div>
      <p style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '1.25rem', marginTop: 0 }}>
        월간 AI 토큰 사용량이 이 값을 초과하면 AI 사용량 대시보드에 경고가 표시됩니다.
      </p>
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151', display: 'block', marginBottom: '0.375rem' }}>
            월간 임계치 (tokens)
          </label>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <input
              type="text"
              value={threshold}
              onChange={e => setThreshold(e.target.value)}
              style={{ flex: 1, maxWidth: '220px', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '0.5rem', fontSize: '0.9rem', color: '#374151' }}
              placeholder="1,000,000"
            />
            <button
              type="submit"
              disabled={pending}
              className="btn btn-primary"
              style={{ opacity: pending ? 0.7 : 1 }}
            >
              {pending ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
        {msg && (
          <p style={{ fontSize: '0.8125rem', color: msg.ok ? '#16a34a' : '#dc2626', margin: 0 }}>
            {msg.text}
          </p>
        )}
      </form>
    </div>
  )
}
