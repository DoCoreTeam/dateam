'use client'

import { useState, useEffect } from 'react'
import { Cloud, CheckCircle, XCircle, Unlink, Loader2 } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'

interface DriveStatus {
  connected: boolean
  email: string | null
}

export default function GoogleDriveSettings() {
  const [status, setStatus] = useState<DriveStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/auth/google-drive/status')
      .then((r) => r.json())
      .then((d: DriveStatus) => setStatus(d))
      .catch(() => setStatus({ connected: false, email: null }))
      .finally(() => setLoading(false))
  }, [])

  async function handleRevoke() {
    setMsg(null)
    setRevoking(true)
    try {
      const res = await fetch('/api/auth/google-drive/revoke', { method: 'POST' })
      if (res.ok) {
        setStatus({ connected: false, email: null })
        setMsg({ ok: true, text: 'Google Drive 연결이 해제되었습니다' })
      } else {
        const d = await res.json() as { error?: string }
        setMsg({ ok: false, text: d.error ?? '연결 해제 실패' })
      }
    } catch {
      setMsg({ ok: false, text: '네트워크 오류가 발생했습니다' })
    } finally {
      setRevoking(false)
    }
  }

  function handleConnect() {
    window.location.href = '/api/auth/google-drive'
  }

  return (
    <div className="card" style={{ padding: '1.5rem', maxWidth: '640px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <Cloud size={16} color="#6366f1" />
        <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
          Google Drive 연동
        </h2>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 0', color: '#94a3b8', fontSize: '0.875rem' }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          연결 상태 확인 중...
        </div>
      ) : status?.connected ? (
        <div style={{ padding: '0.875rem 1rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.625rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle size={14} color="#16a34a" />
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#15803d' }}>연결됨</span>
              {status.email && (
                <span style={{ fontSize: '0.8125rem', color: '#374151', fontFamily: 'monospace' }}>
                  {status.email}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleRevoke}
              disabled={revoking}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                padding: '0.375rem 0.75rem',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#dc2626',
                background: 'none',
                border: '1px solid #fecaca',
                borderRadius: '0.5rem',
                cursor: revoking ? 'not-allowed' : 'pointer',
                minHeight: '32px',
              }}
            >
              {revoking ? (
                <AXDotLoader size={4} color="#dc2626" />
              ) : (
                <Unlink size={12} />
              )}
              연결 해제
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '0 0 0.875rem 0', lineHeight: 1.6 }}>
            Google Drive를 연결하면 담당자 명함 이미지를 Drive에 저장할 수 있습니다.
          </p>
          <button
            type="button"
            onClick={handleConnect}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.5625rem 1.25rem',
              backgroundColor: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              minHeight: '44px',
            }}
          >
            <Cloud size={15} />
            Google 계정 연결
          </button>
        </div>
      )}

      {msg && (
        <div
          role="status"
          style={{
            padding: '0.625rem 0.875rem',
            borderRadius: '0.5rem',
            fontSize: '0.8125rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            backgroundColor: msg.ok ? '#f0fdf4' : '#fef2f2',
            color: msg.ok ? '#15803d' : '#b91c1c',
            border: `1px solid ${msg.ok ? '#bbf7d0' : '#fecaca'}`,
          }}
        >
          {msg.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
          {msg.text}
        </div>
      )}
    </div>
  )
}
