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
    <div className="card" style={{ padding: 'var(--space-6)', maxWidth: '640px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '1.25rem' }}>
        <Cloud size={16} color="var(--brand)" />
        <h2 className="tape-title" style={{ margin: 0 }}>
          Google Drive 연동
        </h2>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-0)', color: 'var(--text-faint)', fontSize: 'var(--fs-base)' }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          연결 상태 확인 중...
        </div>
      ) : status?.connected ? (
        <div style={{ padding: '0.875rem 1rem', backgroundColor: 'var(--success-bg)', border: 'var(--hairline) solid var(--success-border)', borderRadius: 'var(--radius)', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <CheckCircle size={14} color="var(--success)" />
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--success)' }}>연결됨</span>
              {status.email && (
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', fontFamily: 'monospace' }}>
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
                fontSize: 'var(--fs-xs)',
                fontWeight: 600,
                color: 'var(--danger)',
                background: 'none',
                border: 'var(--hairline) solid var(--danger-border)',
                borderRadius: 'var(--radius)',
                cursor: revoking ? 'not-allowed' : 'pointer',
                minHeight: '32px',
              }}
            >
              {revoking ? (
                <AXDotLoader size={4} color="var(--danger)" />
              ) : (
                <Unlink size={12} />
              )}
              연결 해제
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: '1rem' }}>
          <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', margin: '0 0 0.875rem 0', lineHeight: 1.6 }}>
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
              backgroundColor: 'var(--info)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius)',
              fontSize: 'var(--fs-base)',
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
            borderRadius: 'var(--radius)',
            fontSize: 'var(--fs-sm)',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            backgroundColor: msg.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
            color: msg.ok ? 'var(--success)' : 'var(--danger)',
            border: `var(--hairline) solid ${msg.ok ? 'var(--success-border)' : 'var(--danger-border)'}`,
          }}
        >
          {msg.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
          {msg.text}
        </div>
      )}
    </div>
  )
}
