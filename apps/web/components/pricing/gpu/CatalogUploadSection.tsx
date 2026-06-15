'use client'

import { useState, useRef, useCallback } from 'react'
import { Sparkles, Paperclip } from 'lucide-react'

// 카탈로그 파일(xlsx/csv) 일괄 흡수 — 임의 구조를 AI가 헤더 매핑 → 전행 변환 → 검토 대기 적재.
// QuoteRegisterTab에서 분리(파일 크기·단일 책임). is_test 태깅은 부모와 공유.

interface CatalogResult {
  count: number
  blocked: number
  total_rows: number
  truncated: boolean
  mapping: Record<string, unknown> | null
  ai?: { prompt_key?: string; synthesized?: boolean }
}

const MAP_FIELDS: Array<[string, string]> = [
  ['업체', 'competitor_name'], ['모델', 'model_name'], ['메모리', 'memory'],
  ['가격', 'price_usd'], ['요금제', 'pricing_model'],
]

export default function CatalogUploadSection({ isTest }: { isTest: boolean }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<CatalogResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleUpload = useCallback(async (file: File) => {
    setBusy(true); setErr(''); setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('is_test', String(isTest))
      const res = await fetch('/api/pricing/gpu/market/catalog', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.error ?? '카탈로그 흡수 실패'); return }
      setResult(j as CatalogResult)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '카탈로그 흡수 실패')
    } finally {
      setBusy(false)
    }
  }, [isTest])

  const mapping = result?.mapping as Record<string, unknown> | null

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: 'var(--hairline) solid var(--color-border)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Sparkles size={14} style={{ color: 'var(--gpu-accent)' }} /> 카탈로그 파일 일괄 흡수 (xlsx/csv)
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
        컬럼명이 제각각인 경쟁사 카탈로그 파일을 올리면 AI가 우리 스키마에 매핑하고 전체 행을 검토 대기로 적재합니다.
      </div>
      <input className="input-field" ref={inputRef} type="file" accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }}
      />
      <button
        className="gpu-btn"
        data-testid="catalog-upload-btn"
        style={{ marginTop: 8, gap: 6 }}
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        <Paperclip size={13} /> {busy ? 'AI 매핑·변환 중…' : '카탈로그 파일 선택'}
      </button>
      {err && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--gpu-red)' }} data-testid="catalog-error">{err}</div>
      )}
      {result && (
        <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'var(--success-bg)', border: 'var(--hairline) solid var(--success-border)' }} data-testid="catalog-result">
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--success)' }}>
            ✓ 검토 대기 {result.count}건 적재됨{result.blocked > 0 ? ` · 검증 차단 ${result.blocked}건` : ''}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
            원본 {result.total_rows}행{result.truncated ? '(상한 적용)' : ''} · AI 매핑 신뢰도 {String(mapping?._confidence ?? '—')}%
            {result.ai?.synthesized ? ' · 프롬프트 자가보강 사용' : ''}
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {MAP_FIELDS.map(([label, key]) => (
              <div key={key} style={{ display: 'flex', fontSize: 11.5, gap: 8 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 52 }}>{label}</span>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{String(mapping?.[key] ?? '—')}</span>
              </div>
            ))}
            <div style={{ display: 'flex', fontSize: 11.5, gap: 8 }}>
              <span style={{ color: 'var(--text-muted)', minWidth: 52 }}>단위/통화</span>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{String(mapping?._unit ?? '—')} · {String(mapping?._currency ?? '—')}</span>
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}>
            → 검토 대기 탭에서 확인·승인하면 시장비교에 반영됩니다.
          </div>
        </div>
      )}
    </div>
  )
}
