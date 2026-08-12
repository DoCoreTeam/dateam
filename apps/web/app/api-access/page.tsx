'use client'

import { useState } from 'react'
import Link from 'next/link'
import { KeyRound, CheckCircle2 } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'

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
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-8) var(--space-4)' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div
          aria-hidden
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 56, height: 56, marginBottom: 'var(--space-4)',
            background: 'var(--brand)', color: 'var(--brand-fg)',
          }}
        >
          <KeyRound size={28} />
        </div>

        <PageHeader
          title="API 접근 신청"
          description="GPU 가격 데이터 API 접근 권한을 신청합니다."
          actions={<Link href="/develop" className="btn-ghost">API 문서</Link>}
        />

        <div className="card" style={{ padding: 'var(--space-8)' }}>
          {success ? (
            <EmptyState
              icon={<CheckCircle2 size={40} style={{ color: 'var(--success)' }} />}
              title="신청이 접수되었습니다"
              description="관리자 승인 후 로그인 정보를 안내해 드립니다."
              action={{ label: 'API 문서 보기', href: '/develop' }}
            />
          ) : (
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div>
                  <label htmlFor="ax-name" className="label">
                    이름 <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input className="input-field"
                    id="ax-name"
                    type="text"
                    required
                    placeholder="홍길동"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="ax-email" className="label">
                    이메일 <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input className="input-field"
                    id="ax-email"
                    type="email"
                    required
                    placeholder="hong@company.com"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="ax-company" className="label">회사명</label>
                  <input className="input-field"
                    id="ax-company"
                    type="text"
                    placeholder="(주)회사이름"
                    value={form.company}
                    onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="ax-reason" className="label">
                    활용 목적 <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <textarea className="input-field"
                    id="ax-reason"
                    required
                    minLength={10}
                    rows={4}
                    placeholder="API를 어떤 목적으로 활용하실 계획인지 간략히 설명해주세요. (예: 견적 자동화 시스템 연동, 가격 모니터링 등)"
                    value={form.reason}
                    onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                    style={{ resize: 'vertical', minHeight: 100 }}
                  />
                </div>

                {error && <ErrorState message={error} />}

                <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%' }}>
                  {loading ? '신청 처리 중…' : 'API 접근 신청'}
                </button>
              </div>

              <p style={{ textAlign: 'center', marginTop: 'var(--space-4)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                이미 계정이 있으신가요?{' '}
                <Link href="/login" style={{ color: 'var(--brand)' }}>로그인</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
