'use client'

import { useState } from 'react'
import Link from 'next/link'
import { KeyRound, CheckCircle2, ArrowLeft } from 'lucide-react'

export default function ApiAccessPage() {
  const [form, setForm] = useState({ email: '', name: '', company: '', reason: '' })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/public/api-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (data.success) {
        setSuccess(true)
      } else {
        setError(data.error ?? '신청 처리 중 오류가 발생했습니다')
      }
    } catch {
      setError('네트워크 오류가 발생했습니다. 다시 시도해주세요.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        {/* Logo / Brand */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #6366f1, #818cf8)', marginBottom: 16 }}>
            <KeyRound size={28} color="white" />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', margin: '0 0 6px' }}>AX API 접근 신청</h1>
          <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
            GPU 가격 데이터 API 접근 권한을 신청합니다.{' '}
            <Link href="/develop" style={{ color: '#818cf8', textDecoration: 'none' }}>API 문서 →</Link>
          </p>
        </div>

        <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '28px 32px' }}>
          {success ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <CheckCircle2 size={48} color="#10b981" style={{ marginBottom: 16 }} />
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', margin: '0 0 8px' }}>신청 완료!</h2>
              <p style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 24px', lineHeight: 1.6 }}>
                신청이 접수되었습니다.<br />
                관리자 승인 후 로그인 정보를 안내해 드립니다.
              </p>
              <Link href="/develop" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#818cf8', fontSize: 14, textDecoration: 'none' }}>
                <ArrowLeft size={14} /> API 문서 보기
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>
                    이름 <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="홍길동"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>
                    이메일 <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="hong@company.com"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>회사명</label>
                  <input
                    type="text"
                    placeholder="(주)회사이름"
                    value={form.company}
                    onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>
                    활용 목적 <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <textarea
                    required
                    minLength={10}
                    placeholder="API를 어떤 목적으로 활용하실 계획인지 간략히 설명해주세요. (예: 견적 자동화 시스템 연동, 가격 모니터링 등)"
                    value={form.reason}
                    onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                    rows={4}
                    style={{ ...inputStyle, resize: 'vertical', minHeight: 100 }}
                  />
                </div>

                {error && (
                  <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#fca5a5' }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{ marginTop: 4, padding: '11px 0', borderRadius: 10, border: 'none', background: loading ? '#4338ca' : '#6366f1', color: '#fff', fontWeight: 700, fontSize: 15, cursor: loading ? 'not-allowed' : 'pointer', transition: 'background 0.15s' }}
                >
                  {loading ? '신청 중...' : 'API 접근 신청'}
                </button>
              </div>

              <p style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: '#475569' }}>
                이미 계정이 있으신가요?{' '}
                <Link href="/login" style={{ color: '#818cf8', textDecoration: 'none' }}>로그인 →</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.05)',
  color: '#e2e8f0',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
}
