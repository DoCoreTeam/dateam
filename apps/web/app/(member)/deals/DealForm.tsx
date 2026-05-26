'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Deal, Account, Contact } from '@/types/database'

const STAGES = ['신규', '검증', '컨택', 'PoC', '제안', '협상', '수주', '실패'] as const

interface Props {
  deal?: Deal
  accounts: Pick<Account, 'id' | 'name'>[]
  contacts: Pick<Contact, 'id' | 'name' | 'account_id'>[]
  defaultAccountId?: string
}

export default function DealForm({ deal, accounts, contacts, defaultAccountId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    title: deal?.title ?? '',
    account_id: deal?.account_id ?? defaultAccountId ?? '',
    contact_id: deal?.contact_id ?? '',
    stage: deal?.stage ?? '신규',
    value: deal?.value?.toString() ?? '',
    probability: deal?.probability?.toString() ?? '0',
    close_date: deal?.close_date ?? '',
    description: deal?.description ?? '',
    next_action: deal?.next_action ?? '',
    next_action_date: deal?.next_action_date ?? '',
    tags: deal?.tags?.join(', ') ?? '',
  })

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const filteredContacts = form.account_id
    ? contacts.filter((c) => c.account_id === form.account_id)
    : contacts

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) { setError('제목을 입력하세요'); return }
    setLoading(true)
    setError('')

    const payload = {
      title: form.title.trim(),
      account_id: form.account_id || null,
      contact_id: form.contact_id || null,
      stage: form.stage,
      value: form.value ? parseFloat(form.value) : null,
      probability: parseInt(form.probability) || 0,
      close_date: form.close_date || null,
      description: form.description || null,
      next_action: form.next_action || null,
      next_action_date: form.next_action_date || null,
      tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    }

    const url = deal ? `/api/deals/${deal.id}` : '/api/deals'
    const method = deal ? 'PATCH' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json() as { id?: string; error?: string }
    if (!res.ok) { setError(data.error ?? '저장 실패'); setLoading(false); return }
    router.push(`/deals/${data.id ?? deal?.id}`)
    router.refresh()
  }

  const inputStyle = { width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', fontSize: '0.875rem', boxSizing: 'border-box' as const }

  return (
    <div className="card" style={{ padding: '1.5rem', maxWidth: '640px' }}>
      <form
        onSubmit={handleSubmit}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.requestSubmit() } }}
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        <div>
          <label className="label">제목 *</label>
          <input className="input-field" value={form.title} onChange={(e) => set('title', e.target.value)} required style={inputStyle} />
        </div>
        <div>
          <label className="label">거래처</label>
          <select className="input-field" value={form.account_id} onChange={(e) => { set('account_id', e.target.value); set('contact_id', '') }} style={inputStyle}>
            <option value="">선택</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">담당자</label>
          <select className="input-field" value={form.contact_id} onChange={(e) => set('contact_id', e.target.value)} style={inputStyle}>
            <option value="">선택</option>
            {filteredContacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="responsive-grid-cols-2" style={{ gap: '0.75rem' }}>
          <div>
            <label className="label">단계</label>
            <select className="input-field" value={form.stage} onChange={(e) => set('stage', e.target.value)} style={inputStyle}>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">수주 확률 (%)</label>
            <input className="input-field" type="number" min="0" max="100" value={form.probability} onChange={(e) => set('probability', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label className="label">예상 금액 (원)</label>
            <input className="input-field" type="number" value={form.value} onChange={(e) => set('value', e.target.value)} placeholder="500000000" style={inputStyle} />
          </div>
          <div>
            <label className="label">예상 마감일</label>
            <input className="input-field" type="date" value={form.close_date} onChange={(e) => set('close_date', e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div>
          <label className="label">설명</label>
          <textarea className="input-field" value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        <div className="responsive-grid-cols-2" style={{ gap: '0.75rem' }}>
          <div>
            <label className="label">다음 액션</label>
            <input className="input-field" value={form.next_action} onChange={(e) => set('next_action', e.target.value)} placeholder="이메일 발송, 미팅 조율..." style={inputStyle} />
          </div>
          <div>
            <label className="label">액션 날짜</label>
            <input className="input-field" type="date" value={form.next_action_date} onChange={(e) => set('next_action_date', e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div>
          <label className="label">태그 (쉼표 구분)</label>
          <input className="input-field" value={form.tags} onChange={(e) => set('tags', e.target.value)} style={inputStyle} />
        </div>
        {error && <p style={{ color: '#dc2626', fontSize: '0.875rem', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="submit" disabled={loading} className="btn-primary" style={{ minHeight: '44px', padding: '0.625rem 1.5rem' }}>
            {loading ? '저장중...' : deal ? '수정' : '등록'}{!loading && <span style={{ fontSize: '0.7rem', opacity: 0.65, marginLeft: '0.375rem' }}>Ctrl+↵</span>}
          </button>
          <button type="button" onClick={() => router.back()} style={{ minHeight: '44px', padding: '0.625rem 1.25rem', background: 'none', border: '1px solid #e2e8f0', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', color: '#64748b' }}>
            취소
          </button>
        </div>
      </form>
    </div>
  )
}
