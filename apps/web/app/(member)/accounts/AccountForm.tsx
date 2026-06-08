'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Account } from '@/types/database'
import { ACCOUNT_SEGMENTS, ACCOUNT_TYPES, GPU_DEMAND_LEVELS } from '@/lib/crm'

interface Props {
  account?: Account
}

export default function AccountForm({ account }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [scoring, setScoring] = useState(false)
  const [form, setForm] = useState({
    name: account?.name ?? '',
    industry: account?.industry ?? '',
    segment: account?.segment ?? '',
    size: account?.size ?? '',
    region: account?.region ?? '',
    website: account?.website ?? '',
    phone: account?.phone ?? '',
    address: account?.address ?? '',
    description: account?.description ?? '',
    account_type: account?.account_type ?? '',
    gpu_demand_intensity: account?.gpu_demand_intensity ?? '',
    registration_number: account?.registration_number ?? '',
    source: account?.source ?? '',
    tags: account?.tags?.join(', ') ?? '',
  })
  const [fitScore, setFitScore] = useState<number | null>(account?.fit_score ?? null)
  const [fitReason, setFitReason] = useState(account?.fit_reason ?? '')
  const [error, setError] = useState('')

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleFitScore() {
    if (!form.name) { setError('거래처명을 먼저 입력하세요'); return }
    setScoring(true)
    setError('')
    const res = await fetch('/api/accounts/fit-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, industry: form.industry, segment: form.segment, size: form.size, region: form.region }),
    })
    const data = await res.json() as { fit_score?: number; fit_reason?: string; error?: string }
    if (!res.ok) { setError(data.error ?? '오류'); setScoring(false); return }
    setFitScore(data.fit_score ?? null)
    setFitReason(data.fit_reason ?? '')
    setScoring(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('거래처명을 입력하세요'); return }
    setLoading(true)
    setError('')

    const payload = {
      name: form.name.trim(),
      industry: form.industry || null,
      segment: form.segment || null,
      size: form.size || null,
      region: form.region || null,
      website: form.website || null,
      phone: form.phone || null,
      address: form.address || null,
      description: form.description || null,
      account_type: form.account_type || null,
      gpu_demand_intensity: form.gpu_demand_intensity || null,
      registration_number: form.registration_number || null,
      source: form.source || null,
      tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      fit_score: fitScore,
      fit_reason: fitReason || null,
    }

    const url = account ? `/api/accounts/${account.id}` : '/api/accounts'
    const method = account ? 'PATCH' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json() as { id?: string; error?: string }
    if (!res.ok) { setError(data.error ?? '저장 실패'); setLoading(false); return }
    router.push(`/accounts/${data.id ?? account?.id}`)
    router.refresh()
  }

  const inputStyle = { width: '100%', padding: '0.5rem 0.75rem', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box' as const }

  return (
    <div className="card" style={{ padding: '1.5rem', maxWidth: '640px' }}>
      <form
        onSubmit={handleSubmit}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.requestSubmit() } }}
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        <div>
          <label className="label">거래처명 *</label>
          <input className="input-field" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="(주)예시컴퍼니" required style={inputStyle} />
        </div>
        <div>
          <label className="label">설명</label>
          <textarea className="input-field" value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} placeholder="거래처 설명..." style={{ ...inputStyle, resize: 'vertical' }} />
        </div>

        <details style={{ border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', padding: '0.875rem 1rem', background: 'var(--color-bg)' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.875rem', fontWeight: 700 }}>
            상세 필드 열기
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            <div className="responsive-grid-cols-2" style={{ gap: '0.75rem' }}>
              <div>
                <label className="label">거래처유형</label>
                <select className="input-field" value={form.account_type} onChange={(e) => set('account_type', e.target.value)} style={inputStyle}>
                  <option value="">선택</option>
                  {ACCOUNT_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="label">GPU수요강도</label>
                <select className="input-field" value={form.gpu_demand_intensity} onChange={(e) => set('gpu_demand_intensity', e.target.value)} style={inputStyle}>
                  <option value="">선택</option>
                  {GPU_DEMAND_LEVELS.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="label">업종</label>
                <select className="input-field" value={form.industry} onChange={(e) => set('industry', e.target.value)} style={inputStyle}>
                  <option value="">선택</option>
                  {['IT', '제조', '금융', '의료', '유통', '공공', '교육', '기타'].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="label">세그먼트</label>
                <select className="input-field" value={form.segment} onChange={(e) => set('segment', e.target.value)} style={inputStyle}>
                  <option value="">선택</option>
                  {ACCOUNT_SEGMENTS.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="label">기업 규모</label>
                <select className="input-field" value={form.size} onChange={(e) => set('size', e.target.value)} style={inputStyle}>
                  <option value="">선택</option>
                  {['대기업', '중견기업', '중소기업', '스타트업'].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="label">지역</label>
                <select className="input-field" value={form.region} onChange={(e) => set('region', e.target.value)} style={inputStyle}>
                  <option value="">선택</option>
                  {['서울', '경기', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '기타'].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">사업자·기관번호</label>
              <input className="input-field" value={form.registration_number} onChange={(e) => set('registration_number', e.target.value)} placeholder="10자리 번호" style={inputStyle} />
            </div>
            <div>
              <label className="label">출처</label>
              <select className="input-field" value={form.source} onChange={(e) => set('source', e.target.value)} style={inputStyle}>
                <option value="">선택</option>
                {['민간DB', '공공수요예보', '프롬프트', '명함', '음성', '수동'].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label">웹사이트</label>
              <input className="input-field" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://example.com" style={inputStyle} />
            </div>
            <div>
              <label className="label">전화</label>
              <input className="input-field" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="02-0000-0000" style={inputStyle} />
            </div>
            <div>
              <label className="label">주소</label>
              <input className="input-field" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="서울시 강남구..." style={inputStyle} />
            </div>
            <div>
              <label className="label">태그 (쉼표 구분)</label>
              <input className="input-field" value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="AI, 클라우드, 2024H2" style={inputStyle} />
            </div>
          </div>
        </details>

        {/* AI Fit Score */}
        <div style={{ background: 'var(--color-bg)', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', padding: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)' }}>AI 적합도 점수</span>
            <button type="button" onClick={handleFitScore} disabled={scoring} className="btn-primary" style={{ fontSize: '0.8125rem', padding: '0.375rem 0.875rem', minHeight: '36px' }}>
              {scoring ? '분석중...' : 'AI 분석'}
            </button>
          </div>
          {fitScore !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.5rem', fontWeight: 700, color: fitScore >= 70 ? 'var(--success)' : fitScore >= 40 ? 'var(--warning)' : 'var(--danger)' }}>
                {fitScore}점
              </span>
              {fitReason && <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{fitReason}</span>}
            </div>
          )}
        </div>

        {error && <p style={{ color: 'var(--danger)', fontSize: '0.875rem', margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button type="submit" disabled={loading} className="btn-primary" style={{ minHeight: '44px', padding: '0.625rem 1.5rem' }}>
            {loading ? '저장중...' : account ? '수정' : '거래처 등록'}{!loading && <span style={{ fontSize: '0.7rem', opacity: 0.65, marginLeft: '0.375rem' }}>Ctrl+↵</span>}
          </button>
          <button type="button" onClick={() => router.back()} style={{ minHeight: '44px', padding: '0.625rem 1.25rem', background: 'none', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            취소
          </button>
        </div>
      </form>
    </div>
  )
}
