'use client'

import { useState, useEffect } from 'react'
import { Cloud, CheckCircle, XCircle } from 'lucide-react'
import { IntegrationCard, IntegrationStatus } from './integration-ui'

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
    <IntegrationCard
      icon={<Cloud size={16} />}
      title="Google Drive 연동"
      desc="자료 원본을 서비스 서버가 아닌 회사 드라이브에 보관합니다. 담당자 명함 이미지도 여기에 저장됩니다."
    >
      <IntegrationStatus
        loading={loading}
        value={status?.connected ? (status.email ?? '연결된 계정') : null}
        emptyHint="자료 원본을 드라이브에 저장할 수 없습니다"
        onChange={handleConnect}
        onDisconnect={handleRevoke}
        disconnectPending={revoking}
        connectAction={{ label: 'Google 계정 연결', onClick: handleConnect }}
      />

      {msg && (
        <p className={`ci-status ${msg.ok ? 'ci-status-ok' : 'ci-status-danger'}`} role="status">
          {msg.text}
        </p>
      )}
    </IntegrationCard>
  )
}
