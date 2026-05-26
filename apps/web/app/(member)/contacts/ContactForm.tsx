'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Contact, Account } from '@/types/database'

interface Props {
  contact?: Contact
  accounts: Pick<Account, 'id' | 'name'>[]
  defaultAccountId?: string
}

export default function ContactForm({ contact, accounts, defaultAccountId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: contact?.name ?? '',
    account_id: contact?.account_id ?? defaultAccountId ?? '',
    title: contact?.title ?? '',
    department: contact?.department ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    mobile: contact?.mobile ?? '',
    linkedin: contact?.linkedin ?? '',
    notes: contact?.notes ?? '',
  })

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('이름을 입력하세요'); return }
    setLoading(true)
    setError('')

    const payload = {
      name: form.name.trim(),
      account_id: form.account_id || null,
      title: form.title || null,
      department: form.department || null,
      email: form.email || null,
      phone: form.phone || null,
      mobile: form.mobile || null,
      linkedin: form.linkedin || null,
      notes: form.notes || null,
    }

    const url = contact ? `/api/contacts/${contact.id}` : '/api/contacts'
    const method = contact ? 'PATCH' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json() as { id?: string; error?: string }
    if (!res.ok) { setError(data.error ?? '저장 실패'); setLoading(false); return }
    router.push(`/contacts/${data.id ?? contact?.id}`)
    router.refresh()
  }

  const inputStyle = { width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', fontSize: '0.875rem', boxSizing: 'border-box' as const }

  return (
    <div className="card" style={{ padding: '1.5rem', maxWidth: '640px' }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <label className="label">이름 *</label>
          <input className="input-field" value={form.name} onChange={(e) => set('name', e.target.value)} required style={inputStyle} />
        </div>
        <div>
          <label className="label">거래처</label>
          <select className="input-field" value={form.account_id} onChange={(e) => set('account_id', e.target.value)} style={inputStyle}>
            <option value="">선택 (없음)</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="responsive-grid-cols-2" style={{ gap: '0.75rem' }}>
          <div>
            <label className="label">직함/직책</label>
            <input className="input-field" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="팀장" style={inputStyle} />
          </div>
          <div>
            <label className="label">부서</label>
            <input className="input-field" value={form.department} onChange={(e) => set('department', e.target.value)} placeholder="IT기획팀" style={inputStyle} />
          </div>
          <div>
            <label className="label">이메일</label>
            <input className="input-field" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label className="label">직통 전화</label>
            <input className="input-field" value={form.phone} onChange={(e) => set('phone', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label className="label">휴대폰</label>
            <input className="input-field" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label className="label">LinkedIn</label>
            <input className="input-field" value={form.linkedin} onChange={(e) => set('linkedin', e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div>
          <label className="label">메모</label>
          <textarea className="input-field" value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        {error && <p style={{ color: '#dc2626', fontSize: '0.875rem', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="submit" disabled={loading} className="btn-primary" style={{ minHeight: '44px', padding: '0.625rem 1.5rem' }}>
            {loading ? '저장중...' : contact ? '수정' : '담당자 등록'}
          </button>
          <button type="button" onClick={() => router.back()} style={{ minHeight: '44px', padding: '0.625rem 1.25rem', background: 'none', border: '1px solid #e2e8f0', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', color: '#64748b' }}>
            취소
          </button>
        </div>
      </form>
    </div>
  )
}
