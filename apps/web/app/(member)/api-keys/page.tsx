'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Copy, Check, ExternalLink, Key, AlertTriangle } from 'lucide-react'

interface ApiKey {
  id: string
  name: string
  masked_key: string
  raw_key?: string
  status: 'active' | 'revoked'
  created_at: string
  last_used_at: string | null
  request_count: number
  rate_limit_per_minute: number
}

interface NewKeyResult {
  id: string
  name: string
  key: string
  note: string
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newKeyResult, setNewKeyResult] = useState<NewKeyResult | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null)

  const fetchKeys = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/user/api-keys')
      const data = await res.json()
      if (data.success) setKeys(data.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchKeys() }, [fetchKeys])

  async function createKey() {
    if (!newKeyName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/user/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      })
      const data = await res.json()
      if (data.success) {
        setNewKeyResult(data.data)
        setShowCreate(false)
        setNewKeyName('')
        fetchKeys()
      } else {
        alert(data.error ?? 'Failed to create key')
      }
    } finally {
      setCreating(false)
    }
  }

  async function revokeKey(id: string) {
    const res = await fetch(`/api/user/api-keys/${id}`, { method: 'DELETE' })
    const data = await res.json()
    if (data.success) {
      setRevokeConfirm(null)
      fetchKeys()
    } else {
      alert(data.error ?? 'Failed to revoke key')
    }
  }

  function copyText(text: string, id: string) {
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
    try {
      navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
  }

  function fmt(dateStr: string | null) {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  const activeKeys = keys.filter(k => k.status === 'active')
  const revokedKeys = keys.filter(k => k.status === 'revoked')

  return (
    <div className="page-inner" style={{ maxWidth: 800 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Key size={20} color="var(--gpu-indigo, #6366f1)" />
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>API Keys</h1>
          </div>
          <p style={{ color: 'var(--gpu-faint, #94a3b8)', fontSize: 14, margin: 0 }}>
            Manage API keys for programmatic access to GPU pricing data.{' '}
            <a href="/develop" target="_blank" style={{ color: 'var(--gpu-indigo, #6366f1)', textDecoration: 'none' }}>
              API 문서 보기 <ExternalLink size={12} style={{ verticalAlign: 'middle' }} />
            </a>
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--gpu-indigo, #6366f1)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
        >
          <Plus size={16} /> 새 키 생성
        </button>
      </div>

      {/* New key created banner */}
      {newKeyResult && (
        <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Check size={16} color="#10b981" />
            <span style={{ fontWeight: 700, color: '#10b981' }}>API key created — copy it now</span>
          </div>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 12px' }}>이 키는 언제든지 API Keys 페이지에서 다시 복사할 수 있습니다.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0f172a', borderRadius: 8, padding: '10px 14px', border: '1px solid #1e293b' }}>
            <code style={{ flex: 1, fontSize: 13, color: '#e2e8f0', wordBreak: 'break-all', fontFamily: 'monospace' }}>{newKeyResult.key}</code>
            <button onClick={() => copyText(newKeyResult.key, 'newkey')} style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 6, border: '1px solid #334155', background: '#1e293b', color: copiedId === 'newkey' ? '#10b981' : '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
              {copiedId === 'newkey' ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <button onClick={() => setNewKeyResult(null)} style={{ marginTop: 10, fontSize: 12, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>닫기</button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div style={{ background: 'var(--gpu-card, #1e293b)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 15 }}>새 API Key 생성</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              autoFocus
              type="text"
              placeholder="e.g., Production Integration"
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createKey()}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: 14, outline: 'none' }}
            />
            <button onClick={createKey} disabled={creating || !newKeyName.trim()} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 600, fontSize: 14, cursor: creating ? 'not-allowed' : 'pointer', opacity: creating || !newKeyName.trim() ? 0.5 : 1 }}>
              {creating ? '생성 중...' : '생성'}
            </button>
            <button onClick={() => { setShowCreate(false); setNewKeyName('') }} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}>취소</button>
          </div>
        </div>
      )}

      {/* Active keys */}
      {loading ? (
        <div style={{ color: '#64748b', fontSize: 14 }}>로딩 중...</div>
      ) : activeKeys.length === 0 && !showCreate ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#475569' }}>
          <Key size={40} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.3 }} />
          <div style={{ fontWeight: 600, marginBottom: 6 }}>API Key가 없습니다</div>
          <div style={{ fontSize: 14 }}>새 키를 생성하여 외부 시스템에서 GPU 가격 데이터에 접근하세요.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {activeKeys.map(k => (
            <div key={k.id} style={{ background: 'var(--gpu-card, #1e293b)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{k.name}</span>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 100, background: 'rgba(16,185,129,0.1)', color: '#10b981', fontWeight: 600 }}>active</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <code style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>{k.masked_key}</code>
                    <button
                      onClick={() => {
                        if (k.raw_key) {
                          copyText(k.raw_key, k.id + '-copy')
                        } else {
                          alert('이전에 생성된 키는 원문을 불러올 수 없습니다. 기존 키를 폐기하고 새 키를 생성해주세요.')
                        }
                      }}
                      title={k.raw_key ? 'API 키 복사' : '원문 없음 — 새 키 생성 필요'}
                      style={{ display: 'flex', alignItems: 'center', padding: '3px 7px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.1)', background: copiedId === k.id + '-copy' ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)', color: copiedId === k.id + '-copy' ? '#10b981' : k.raw_key ? '#64748b' : '#334155', cursor: 'pointer', transition: 'all 0.15s', opacity: k.raw_key ? 1 : 0.5 }}
                    >
                      {copiedId === k.id + '-copy' ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: '#475569' }}>생성일: {fmt(k.created_at)}</span>
                    <span style={{ fontSize: 12, color: '#475569' }}>마지막 사용: {fmt(k.last_used_at)}</span>
                    <span style={{ fontSize: 12, color: '#475569' }}>요청: {k.request_count.toLocaleString()}회</span>
                    <span style={{ fontSize: 12, color: '#475569' }}>{k.rate_limit_per_minute} req/min</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {revokeConfirm === k.id ? (
                    <>
                      <button onClick={() => revokeKey(k.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 7, border: '1px solid #ef4444', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                        <AlertTriangle size={14} /> 확인
                      </button>
                      <button onClick={() => setRevokeConfirm(null)} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>취소</button>
                    </>
                  ) : (
                    <button onClick={() => setRevokeConfirm(k.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)', color: '#ef4444', fontSize: 13, cursor: 'pointer' }}>
                      <Trash2 size={14} /> 폐기
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Revoked keys */}
      {revokedKeys.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>폐기된 키</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {revokedKeys.map(k => (
              <div key={k.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 10, padding: '12px 16px', opacity: 0.6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 500, fontSize: 14 }}>{k.name}</span>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 100, background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontWeight: 600 }}>revoked</span>
                </div>
                <code style={{ fontSize: 12, color: '#475569', fontFamily: 'monospace' }}>{k.masked_key}</code>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
