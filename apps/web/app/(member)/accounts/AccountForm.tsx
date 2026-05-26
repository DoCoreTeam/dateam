'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Account } from '@/types/database'

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
    tags: account?.tags?.join(', ') ?? '',
  })
  const [fitScore, setFitScore] = useState<number | null>(account?.fit_score ?? null)
  const [fitReason, setFitReason] = useState('')
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
      tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      fit_score: fitScore,
    }

    const url = account ? `/api/accounts/${account.id}` : '/api/accounts'
    const method = account ? 'PATCH' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json() as { id?: string; error?: string }
    if (!res.ok) { setError(data.error ?? '저장 실패'); setLoading(false); return }
    router.push(`/accounts/${data.id ?? account?.id}`)
    router.refresh()
  }

  const inputStyle = { width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box' as const }

  return (
    <div className="card" style={{ padding: '1.5rem', maxWidth: '640px' }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <label className="label">거래처명 *</label>
          <input className="input-field" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="(주)예시컴퍼니" required style={inputStyle} />
        </div>
        <div className="responsive-grid-cols-2" style={{ gap: '0.75rem' }}>
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
              {['엔터프라이즈', 'SMB', '공공', '스타트업'].map((v) => <option key={v} value={v}>{v}</option>)}
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
          <label className="label">설명</label>
          <textarea className="input-field" value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} placeholder="거래처 설명..." style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        <div>
          <label className="label">태그 (쉼표 구분)</label>
          <input className="input-field" value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="AI, 클라우드, 2024H2" style={inputStyle} />
        </div>

        {/* AI Fit Score */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.75rem', padding: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>AI 적합도 점수</span>
            <button type="button" onClick={handleFitScore} disabled={scoring} className="btn-primary" style={{ fontSize: '0.8125rem', padding: '0.375rem 0.875rem', minHeight: '36px' }}>
              {scoring ? '분석중...' : 'AI 분석'}
            </button>
          </div>
          {fitScore !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.5rem', fontWeight: 700, color: fitScore >= 70 ? '#16a34a' : fitScore >= 40 ? '#d97706' : '#dc2626' }}>
                {fitScore}점
              </span>
              {fitReason && <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>{fitReason}</span>}
            </div>
          )}
        </div>

        {error && <p style={{ color: '#dc2626', fontSize: '0.875rem', margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button type="submit" disabled={loading} className="btn-primary" style={{ minHeight: '44px', padding: '0.625rem 1.5rem' }}>
            {loading ? '저장중...' : account ? '수정' : '거래처 등록'}
          </button>
          <button type="button" onClick={() => router.back()} style={{ minHeight: '44px', padding: '0.625rem 1.25rem', background: 'none', border: '1px solid #e2e8f0', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', color: '#64748b' }}>
            취소
          </button>
        </div>
      </form>
    </div>
  )
}
