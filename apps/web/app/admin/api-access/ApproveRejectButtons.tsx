'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { approveRequest, rejectRequest } from './actions'
import { CheckCircle2, XCircle, Copy, Check } from 'lucide-react'

export default function ApproveRejectButtons({ requestId }: { requestId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [result, setResult] = useState<{ type: 'approved'; tempPassword: string } | { type: 'rejected' } | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleApprove() {
    setLoading(true)
    try {
      const res = await approveRequest(requestId)
      if (res.success && res.tempPassword) {
        setResult({ type: 'approved', tempPassword: res.tempPassword })
      } else {
        alert(res.error ?? '승인 실패')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleReject() {
    setLoading(true)
    try {
      const res = await rejectRequest(requestId, rejectNote)
      if (res.success) {
        setResult({ type: 'rejected' })
        router.refresh()
      } else {
        alert(res.error ?? '거절 실패')
      }
    } finally {
      setLoading(false)
    }
  }

  function copyPw(pw: string) {
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    try { navigator.clipboard.writeText(pw) } catch {
      const ta = document.createElement('textarea')
      ta.value = pw; ta.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }
  }

  if (result?.type === 'approved') {
    return (
      <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>
        <div style={{ color: '#10b981', fontWeight: 600, marginBottom: 6 }}>✓ 승인 완료</div>
        <div style={{ color: '#64748b', marginBottom: 4 }}>임시 비밀번호:</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <code style={{ fontSize: 13, color: '#e2e8f0', background: '#1e293b', padding: '2px 8px', borderRadius: 4, flex: 1 }}>
            {result.tempPassword}
          </code>
          <button onClick={() => result.type === 'approved' && copyPw(result.tempPassword)} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid #334155', background: '#1e293b', color: copied ? '#10b981' : '#94a3b8', cursor: 'pointer', fontSize: 12 }}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#475569', marginBottom: 8 }}>사용자에게 직접 전달해주세요</div>
        <button
          onClick={() => router.refresh()}
          style={{ width: '100%', padding: '5px 0', borderRadius: 6, border: '1px solid rgba(16,185,129,0.4)', background: 'transparent', color: '#10b981', fontSize: 12, cursor: 'pointer' }}
        >
          확인 완료 — 목록 갱신
        </button>
      </div>
    )
  }

  if (result?.type === 'rejected') {
    return <span style={{ color: '#dc2626', fontSize: 13, fontWeight: 600 }}>✓ 거절 처리됨</span>
  }

  if (showReject) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
        <input
          type="text"
          placeholder="거절 사유 (선택)"
          value={rejectNote}
          onChange={e => setRejectNote(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13, outline: 'none' }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleReject} disabled={loading} style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
            {loading ? '처리중...' : '거절 확인'}
          </button>
          <button onClick={() => setShowReject(false)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer' }}>
            취소
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button
        onClick={handleApprove}
        disabled={loading}
        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 6, border: 'none', background: '#dcfce7', color: '#16a34a', fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}
      >
        <CheckCircle2 size={14} /> 승인
      </button>
      <button
        onClick={() => setShowReject(true)}
        disabled={loading}
        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 6, border: 'none', background: '#fee2e2', color: '#dc2626', fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}
      >
        <XCircle size={14} /> 거절
      </button>
    </div>
  )
}
