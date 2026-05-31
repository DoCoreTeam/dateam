'use client'

import { useState } from 'react'
import { Trash2, AlertTriangle } from 'lucide-react'

export default function RevokeKeyButton({ keyId, keyName }: { keyId: string; keyName: string }) {
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function revoke() {
    setLoading(true)
    try {
      const res = await fetch(`/api/user/api-keys/${keyId}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setDone(true)
      } else {
        alert(data.error ?? '폐기 실패')
      }
    } finally {
      setLoading(false)
      setConfirm(false)
    }
  }

  if (done) return <span style={{ fontSize: 13, color: '#dc2626', fontWeight: 600 }}>폐기됨</span>

  if (confirm) {
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={revoke} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 10px', borderRadius: 6, border: 'none', background: '#fef2f2', color: '#dc2626', fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
          <AlertTriangle size={12} /> 확인
        </button>
        <button onClick={() => setConfirm(false)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, cursor: 'pointer' }}>취소</button>
      </div>
    )
  }

  return (
    <button onClick={() => setConfirm(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)', color: '#ef4444', fontSize: 12, cursor: 'pointer' }} title={`"${keyName}" 키 폐기`}>
      <Trash2 size={13} /> 폐기
    </button>
  )
}
