'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ParsedLeadData } from '@/lib/gemini-lead'

type Tab = 'prompt' | 'file'

export default function LeadIntakeForm() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('prompt')
  const [rawInput, setRawInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ parsed: ParsedLeadData; intakeId: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!rawInput.trim()) { setError('내용을 입력하세요'); return }
    setLoading(true)
    setError('')
    setResult(null)

    const res = await fetch('/api/leads/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_input: rawInput, source: tab }),
    })
    const data = await res.json() as { parsed?: ParsedLeadData; intake?: { id: string }; error?: string }
    if (!res.ok) { setError(data.error ?? '오류'); setLoading(false); return }
    setResult({ parsed: data.parsed!, intakeId: data.intake?.id ?? '' })
    setLoading(false)
  }

  async function handleCreate() {
    if (!result) return
    setCreating(true)
    const { parsed } = result

    if (parsed.company_name) {
      const accRes = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: parsed.company_name,
          industry: parsed.industry,
          segment: parsed.segment,
          size: parsed.size,
          region: parsed.region,
          website: parsed.website,
          phone: parsed.company_phone,
          address: parsed.address,
          fit_score: parsed.fit_score,
          tags: parsed.tags ?? [],
        }),
      })
      const accData = await accRes.json() as { id?: string }

      if (parsed.contact_name && accData.id) {
        await fetch('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: accData.id,
            name: parsed.contact_name,
            title: parsed.contact_title,
            department: parsed.contact_department,
            email: parsed.contact_email,
            phone: parsed.contact_phone,
            mobile: parsed.contact_mobile,
          }),
        })
      }

      if (accData.id) {
        await fetch('/api/deals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: accData.id,
            title: parsed.deal_title ?? `${parsed.company_name} 신규 협력`,
            description: parsed.deal_description,
            next_action: parsed.next_action,
            stage: '신규',
          }),
        })
      }
    }

    setCreated(true)
    setCreating(false)
    router.refresh()
  }

  const tabStyle = (t: Tab) => ({
    padding: '0.5rem 1.25rem',
    borderRadius: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: 600 as const,
    cursor: 'pointer' as const,
    border: 'none',
    background: tab === t ? '#6366f1' : '#f1f5f9',
    color: tab === t ? 'white' : '#64748b',
    minHeight: '40px',
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button style={tabStyle('prompt')} onClick={() => setTab('prompt')}>텍스트 입력</button>
        <button style={tabStyle('file')} onClick={() => setTab('file')}>명함/문서</button>
      </div>

      {!result ? (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {tab === 'prompt' ? (
            <div>
              <label className="label">리드 정보 입력</label>
              <textarea
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                rows={6}
                placeholder={`예시:\n삼성SDS 김철수 부장 (IT전략팀)\nkcs@samsung.com / 02-6360-0000\n클라우드 전환 프로젝트 논의 필요\n내주 화요일 킥오프 미팅 예정`}
                style={{ width: '100%', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', fontSize: '0.875rem', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6 }}
              />
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.375rem 0 0' }}>
                명함 정보, 미팅 메모, 이메일 본문 등 자유롭게 붙여넣기하세요
              </p>
            </div>
          ) : (
            <div style={{ border: '2px dashed #e2e8f0', borderRadius: '0.75rem', padding: '2rem', textAlign: 'center' }}>
              <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: '0 0 0.75rem' }}>명함 이미지나 엑셀 파일을 붙여넣거나 텍스트로 입력하세요</p>
              <textarea
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                rows={4}
                placeholder="명함/문서에서 복사한 텍스트를 붙여넣기하세요..."
                style={{ width: '100%', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', fontSize: '0.875rem', resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>
          )}

          {error && <p style={{ color: '#dc2626', fontSize: '0.875rem', margin: 0 }}>{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary" style={{ padding: '0.75rem 1.5rem', fontSize: '0.9375rem', minHeight: '48px', maxWidth: '200px' }}>
            {loading ? '🤖 AI 분석중...' : '🤖 AI 분석'}
          </button>
        </form>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.75rem', padding: '1.25rem' }}>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#166534', margin: '0 0 0.875rem' }}>
              ✅ AI 분석 완료
              {result.parsed.fit_score !== undefined && (
                <span style={{ marginLeft: '0.75rem', fontSize: '0.875rem', color: result.parsed.fit_score >= 70 ? '#16a34a' : '#d97706' }}>
                  Fit 점수: {result.parsed.fit_score}점
                </span>
              )}
            </h3>
            <div className="responsive-grid-cols-2" style={{ gap: '0.75rem' }}>
              {result.parsed.company_name && (
                <div>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>회사명</span>
                  <div style={{ fontSize: '0.9rem', color: '#0f172a', fontWeight: 600 }}>{result.parsed.company_name}</div>
                </div>
              )}
              {result.parsed.contact_name && (
                <div>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>담당자</span>
                  <div style={{ fontSize: '0.9rem', color: '#0f172a' }}>{result.parsed.contact_name} {result.parsed.contact_title && `· ${result.parsed.contact_title}`}</div>
                </div>
              )}
              {result.parsed.contact_email && (
                <div>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>이메일</span>
                  <div style={{ fontSize: '0.875rem', color: '#374151' }}>{result.parsed.contact_email}</div>
                </div>
              )}
              {result.parsed.industry && (
                <div>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>업종</span>
                  <div style={{ fontSize: '0.875rem', color: '#374151' }}>{result.parsed.industry}</div>
                </div>
              )}
              {result.parsed.next_action && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>AI 추천 다음 액션</span>
                  <div style={{ fontSize: '0.875rem', color: '#374151' }}>{result.parsed.next_action}</div>
                </div>
              )}
              {result.parsed.fit_reason && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>적합도 분석</span>
                  <div style={{ fontSize: '0.875rem', color: '#374151' }}>{result.parsed.fit_reason}</div>
                </div>
              )}
            </div>
          </div>

          {created ? (
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '0.75rem', padding: '1rem', textAlign: 'center' }}>
              <p style={{ color: '#0284c7', fontWeight: 600, margin: 0 }}>✅ 거래처·담당자·영업기회가 CRM에 등록되었습니다</p>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button onClick={handleCreate} disabled={creating} className="btn-primary" style={{ padding: '0.625rem 1.25rem', minHeight: '44px' }}>
                {creating ? '등록중...' : '거래처/담당자/영업기회 생성'}
              </button>
              <button onClick={() => { setResult(null); setRawInput('') }} style={{ padding: '0.625rem 1.25rem', minHeight: '44px', background: 'none', border: '1px solid #e2e8f0', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', color: '#64748b' }}>
                다시 입력
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
