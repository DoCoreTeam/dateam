'use client'

// GPU 검토대기 카드의 보조 패널 — 산출근거 / 과금구조 / 재분석결과 / 원본링크.
// ReviewTab에서 분리(파일 비대화 방지) + 스타일은 globals.css .gpu-rev-* 클래스 SSOT(인라인 금지).

import { ChevronDown, ChevronUp, ArrowRight, Sparkles, FileText } from 'lucide-react'
import { buildPriceBreakdown } from '@/lib/gpu/price-breakdown'
import { parseBilling } from '@/lib/gpu/billing'
import type { FieldDiff } from '@/lib/gpu/extract-diff'

// AI 추출 단가와 SSOT 정합 단가가 이 비율 넘게 다르면 환산 불일치 경고
const MISMATCH_THRESHOLD = 0.05

const BILLING_MODEL_LABEL: Record<string, string> = {
  hourly: '시간당',
  monthly: '월정액',
  one_time_plus_monthly: '설치비 + 월정액',
}

export interface RecheckResult {
  summary: string
  diff: FieldDiff[]
  iteration: number
}

export function fmtDiffValue(v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

function won(n: number | null): string {
  return n != null ? `₩${n.toLocaleString('ko-KR')}` : '—'
}

interface ExtractedProp {
  extracted: Record<string, unknown>
}

/** 단가 산출 근거 — 원본가→환율→시간환산→USD/장·hr (펼침) */
export function PriceBreakdownPanel({ extracted, krwPerUsd, open, onToggle }: ExtractedProp & {
  krwPerUsd: number | null
  open: boolean
  onToggle: () => void
}) {
  if (extracted.unit_price_usd == null) return null
  const breakdown = buildPriceBreakdown({
    originalPrice: typeof extracted.original_price === 'number' ? extracted.original_price : null,
    originalCurrency: typeof extracted.original_currency === 'string' ? extracted.original_currency : null,
    originalUnit: typeof extracted.original_unit === 'string' ? extracted.original_unit : null,
    gpuCount: typeof extracted.gpu_count === 'number' ? extracted.gpu_count : 1,
    krwPerUsd: krwPerUsd ?? 0,
  })
  const aiVal = typeof extracted.unit_price_usd === 'number' ? extracted.unit_price_usd : null
  const mismatch = breakdown.ok && aiVal != null && breakdown.usdPerGpuHour != null
    && Math.abs(breakdown.usdPerGpuHour - aiVal) / Math.max(aiVal, 0.0001) > MISMATCH_THRESHOLD

  return (
    <div style={{ marginTop: 10 }}>
      <button onClick={onToggle} className="gpu-rev-toggle">
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        단가 산출 근거 {mismatch && <span className="gpu-badge" style={{ background: 'var(--warning)', color: 'var(--surface-bg)' }}>환산 불일치</span>}
      </button>
      {open && (
        <div className="gpu-rev-panel gpu-rev-panel--breakdown">
          {breakdown.ok ? (
            <div className="gpu-rev-rows">
              {breakdown.steps.map((s, i) => (
                <div key={i} className="gpu-rev-row">
                  <span className="gpu-rev-row-k">{s.label}</span>
                  {s.detail && <span className="gpu-rev-row-detail">{s.detail}</span>}
                  <span className={s.label === '정합 단가' ? 'gpu-rev-amount' : 'gpu-rev-row-v'} style={s.label === '정합 단가' ? { flex: 1, textAlign: 'right' } : undefined}>{s.value}</span>
                </div>
              ))}
              {mismatch && (
                <div className="gpu-rev-warn">
                  ⚠️ AI 추출 단가({aiVal} USD/hr)와 매매기준율 기준 정합 단가({breakdown.usdPerGpuHour?.toFixed(4)})가 다릅니다. 환율·시간 환산을 확인하세요.
                </div>
              )}
            </div>
          ) : (
            <div className="gpu-rev-row-k" style={{ minWidth: 0 }}>산출 근거 표시 불가: {breakdown.reason}{!krwPerUsd && ' (매매기준율 로딩 필요)'}</div>
          )}
        </div>
      )}
    </div>
  )
}

/** 과금구조 — 설치비(일회성) + 월 단가 분리 표시 */
export function BillingPanel({ extracted }: ExtractedProp) {
  const billing = parseBilling(extracted)
  if (!billing.hasSeparateSetup && billing.monthlyPriceKrw == null) return null
  return (
    <div className="gpu-rev-panel gpu-rev-panel--billing" data-testid="billing-structure">
      <div className="gpu-rev-panel-title gpu-rev-panel-title--billing">
        과금 구조{billing.billingModel ? ` · ${BILLING_MODEL_LABEL[billing.billingModel] ?? billing.billingModel}` : ''}
      </div>
      <div className="gpu-rev-rows">
        {billing.setupFeeKrw != null && (
          <div className="gpu-rev-row">
            <span className="gpu-rev-row-k">설치비 (1회성)</span>
            <span className="gpu-rev-amount">{won(billing.setupFeeKrw)}</span>
          </div>
        )}
        {billing.monthlyPriceKrw != null && (
          <div className="gpu-rev-row">
            <span className="gpu-rev-row-k">월 단가</span>
            <span className="gpu-rev-amount">{won(billing.monthlyPriceKrw)} / 월</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** 재분석 결과 — 변경 전/후 diff + AI 근거 */
export function RecheckResultPanel({ result }: { result: RecheckResult }) {
  return (
    <div className="gpu-rev-panel gpu-rev-panel--recheck" data-testid="recheck-result">
      <div className="gpu-rev-panel-title gpu-rev-panel-title--recheck">
        <Sparkles size={13} /> 재분석 결과 ({result.iteration}차)
      </div>
      {result.summary && <div className="gpu-rev-summary">{result.summary}</div>}
      {result.diff.length === 0 ? (
        <div className="gpu-rev-row-k" style={{ minWidth: 0 }}>변경된 항목이 없습니다.</div>
      ) : (
        <div className="gpu-rev-rows">
          {result.diff.map((d) => (
            <div key={d.field} className="gpu-rev-diff-row">
              <span className="gpu-rev-row-k">{d.label}</span>
              <span className="gpu-rev-diff-before">{fmtDiffValue(d.before)}</span>
              <ArrowRight size={12} style={{ color: 'var(--gpu-muted)' }} />
              <span className="gpu-rev-diff-after">{fmtDiffValue(d.after)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 원본데이터(Drive) 링크 — 역추적 */
export function EvidenceLink({ fileId }: { fileId: string }) {
  return (
    <a
      href={`/api/pricing/gpu/evidence/${fileId}`}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="evidence-link"
      className="gpu-rev-evidence"
    >
      <FileText size={13} /> 원본 보기
    </a>
  )
}
