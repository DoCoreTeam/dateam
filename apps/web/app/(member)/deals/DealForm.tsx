'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Deal, Account, Contact } from '@/types/database'
import { DEAL_NATURES, LEAD_TYPES, PRODUCTS, probabilityForStage } from '@/lib/crm'
import { useFormCore } from '@/lib/forms/useFormCore'
import DraftRestoreBanner from '@/components/ui/DraftRestoreBanner'

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
  const formRef = useRef<HTMLFormElement>(null)
  const initialForm = {
    title: deal?.title ?? '',
    account_id: deal?.account_id ?? defaultAccountId ?? '',
    contact_id: deal?.contact_id ?? '',
    stage: deal?.stage ?? '신규',
    value: deal?.value?.toString() ?? '',
    close_date: deal?.close_date ?? '',
    expected_date: deal?.expected_date ?? '',
    description: deal?.description ?? '',
    next_action: deal?.next_action ?? '',
    next_action_date: deal?.next_action_date ?? '',
    lead_type: deal?.lead_type ?? '',
    product: deal?.product ?? '',
    fit_score: deal?.fit_score?.toString() ?? '',
    hw_included: deal?.hw_included ? 'true' : 'false',
    is_new_deal: deal?.is_new_deal === false ? '계속' : '신규',
    funding_source: deal?.funding_source ?? '',
    procurement_status: deal?.procurement_status ?? '',
    source: deal?.source ?? '',
    tags: deal?.tags?.join(', ') ?? '',
  }
  const fc = useFormCore<typeof initialForm>({ formId: 'deal', recordId: deal?.id ?? 'new', initial: initialForm, scopeRef: formRef })
  const form = fc.value
  const setForm = (next: typeof initialForm) => fc.set(next)

  function set(field: string, value: string) {
    setForm({ ...form, [field]: value })
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
      close_date: form.close_date || null,
      expected_date: form.expected_date || null,
      description: form.description || null,
      next_action: form.next_action || null,
      next_action_date: form.next_action_date || null,
      lead_type: form.lead_type || null,
      product: form.product || null,
      fit_score: form.fit_score ? parseInt(form.fit_score) : null,
      hw_included: form.hw_included === 'true',
      is_new_deal: form.is_new_deal !== '계속',
      funding_source: form.funding_source || null,
      procurement_status: form.procurement_status || null,
      source: form.source || null,
      tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    }

    const url = deal ? `/api/deals/${deal.id}` : '/api/deals'
    const method = deal ? 'PATCH' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json() as { id?: string; error?: string }
    if (!res.ok) { setError(data.error ?? '저장 실패'); setLoading(false); return }
    fc.clear()
    router.push(`/deals/${data.id ?? deal?.id}`)
    router.refresh()
  }

  const inputStyle = { width: '100%', padding: 'var(--space-2) var(--space-3)', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', fontSize: 'var(--fs-base)', boxSizing: 'border-box' as const }

  return (
    <div className="card" style={{ padding: 'var(--space-6)', maxWidth: '640px' }}>
      <DraftRestoreBanner show={fc.hasDraft} onRestore={fc.restore} onDiscard={fc.discard} />
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.requestSubmit() } }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
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
        <div className="responsive-grid-cols-2" style={{ gap: 'var(--space-3)' }}>
          <div>
            <label className="label">단계</label>
            <select className="input-field" value={form.stage} onChange={(e) => set('stage', e.target.value)} style={inputStyle}>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">수주 확률 (%)</label>
            <input className="input-field" value={probabilityForStage(form.stage)} readOnly style={{ ...inputStyle, background: 'var(--color-bg)', color: 'var(--text-muted)' }} />
          </div>
          <div>
            <label className="label">예상 금액 (원)</label>
            <input className="input-field" type="number" value={form.value} onChange={(e) => set('value', e.target.value)} placeholder="500000000" style={inputStyle} />
          </div>
          <div>
            <label className="label">예상 마감일</label>
            <input className="input-field" type="date" value={form.close_date} onChange={(e) => set('close_date', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label className="label">예상시기·발주시기</label>
            <input className="input-field" value={form.expected_date} onChange={(e) => set('expected_date', e.target.value)} placeholder="2026년 2분기 또는 2026-06" style={inputStyle} />
          </div>
          <div>
            <label className="label">적합도점수</label>
            <input className="input-field" type="number" min="0" max="100" value={form.fit_score} onChange={(e) => set('fit_score', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label className="label">리드유형</label>
            <select className="input-field" value={form.lead_type} onChange={(e) => set('lead_type', e.target.value)} style={inputStyle}>
              <option value="">선택</option>
              {LEAD_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">제품</label>
            <select className="input-field" value={form.product} onChange={(e) => set('product', e.target.value)} style={inputStyle}>
              <option value="">선택</option>
              {PRODUCTS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">신규·계속</label>
            <select className="input-field" value={form.is_new_deal} onChange={(e) => set('is_new_deal', e.target.value)} style={inputStyle}>
              {DEAL_NATURES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">HW도입여부</label>
            <select className="input-field" value={form.hw_included} onChange={(e) => set('hw_included', e.target.value)} style={inputStyle}>
              <option value="false">N</option>
              <option value="true">Y</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">설명</label>
          <textarea className="input-field" value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        <div className="responsive-grid-cols-2" style={{ gap: 'var(--space-3)' }}>
          <div>
            <label className="label">다음 액션</label>
            <input className="input-field" value={form.next_action} onChange={(e) => set('next_action', e.target.value)} placeholder="이메일 발송, 미팅 조율..." style={inputStyle} />
          </div>
          <div>
            <label className="label">액션 날짜</label>
            <input className="input-field" type="date" value={form.next_action_date} onChange={(e) => set('next_action_date', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label className="label">재원</label>
            <input className="input-field" value={form.funding_source} onChange={(e) => set('funding_source', e.target.value)} placeholder="국비, 자체예산 등" style={inputStyle} />
          </div>
          <div>
            <label className="label">발주여부</label>
            <input className="input-field" value={form.procurement_status} onChange={(e) => set('procurement_status', e.target.value)} placeholder="예정, 발주, 미정 등" style={inputStyle} />
          </div>
        </div>
        <div>
          <label className="label">출처</label>
          <select className="input-field" value={form.source} onChange={(e) => set('source', e.target.value)} style={inputStyle}>
            <option value="">선택</option>
            {['민간DB', '공공수요예보', '프롬프트', '명함', '음성', '수동'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="label">태그 (쉼표 구분)</label>
          <input className="input-field" value={form.tags} onChange={(e) => set('tags', e.target.value)} style={inputStyle} />
        </div>
        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--fs-base)', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button type="submit" disabled={loading} className="btn-primary" style={{ minHeight: '44px', padding: '0.625rem 1.5rem' }}>
            {loading ? '저장중...' : deal ? '수정' : '등록'}{!loading && <span style={{ fontSize: '0.7rem', opacity: 0.65, marginLeft: '0.375rem' }}>Ctrl+↵</span>}
          </button>
          <button type="button" onClick={() => router.back()} style={{ minHeight: '44px', padding: '0.625rem 1.25rem', background: 'none', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 'var(--fs-base)', color: 'var(--text-muted)' }}>
            취소
          </button>
        </div>
      </form>
    </div>
  )
}
