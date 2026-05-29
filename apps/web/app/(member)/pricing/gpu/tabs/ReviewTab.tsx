'use client'

import { useState, useCallback } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import { fetcher } from '@/lib/swr-config'
import { AlertTriangle, CheckCircle2, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'

interface ReviewItem {
  id: string
  product_hint: string | null
  supplier_hint: string | null
  channel: string | null
  impact_level: string | null
  status: string
  current_iteration: number
  current_extracted: Record<string, unknown> | null
  current_confidence: Record<string, number | null> | null
  overall_confidence: number | null
  created_at: string
  is_test: boolean
}

const IMPACT_CONFIG: Record<string, { label: string; color: string }> = {
  new_model: { label: '신규 모델', color: 'var(--gpu-accent)' },
  big_swing: { label: '급격한 변동', color: 'var(--gpu-red)' },
  price_low_change: { label: '소폭 변동', color: 'var(--gpu-amber)' },
  steady: { label: '안정적', color: 'var(--gpu-green)' },
}

const CONF_FIELDS = ['model_name', 'unit_price_usd', 'supplier', 'term', 'valid_until', 'min_qty']
const CONF_LABELS: Record<string, string> = {
  model_name: '모델명',
  unit_price_usd: '단가 (USD)',
  supplier: '공급사',
  term: '약정',
  valid_until: '유효기간',
  min_qty: '최소 수량',
}

function ConfidenceBar({ value, label }: { value: number | null; label: string }) {
  const pct = value ?? 0
  const color = pct >= 90 ? 'var(--gpu-green)' : pct >= 70 ? 'var(--gpu-amber)' : 'var(--gpu-red)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ minWidth: 64, color: 'var(--gpu-muted)' }}>{label}</span>
      <div className="gpu-conf-bar" style={{ flex: 1, maxWidth: 120 }}>
        <i style={{ width: `${pct}%`, background: color }} />
      </div>
      <span style={{ minWidth: 32, fontWeight: 700, color }}>{value != null ? `${value}%` : '—'}</span>
    </div>
  )
}

function ReviewCard({ item, onDone }: { item: ReviewItem; onDone: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [checking, setChecking] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [rechecking, setRechecking] = useState(false)
  const [recheckErr, setRecheckErr] = useState('')

  const extracted = item.current_extracted ?? {}
  const confidence = item.current_confidence ?? {}

  // 신뢰도 90% 미만 항목 — 필수 체크
  const lowConfFields = CONF_FIELDS.filter((f) => {
    const v = confidence[f]
    return v != null && v < 90
  })
  const allLowChecked = lowConfFields.every((f) => checking.has(f))
  const canConfirm = allLowChecked || lowConfFields.length === 0

  const toggleCheck = (field: string) => {
    setChecking((prev) => {
      const next = new Set(prev)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }

  const handleConfirm = useCallback(async () => {
    setConfirming(true)
    try {
      const res = await fetch(`/api/pricing/gpu/review/${item.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          confirmed_items: Array.from(checking),
        }),
      })
      if (!res.ok) {
        const j = await res.json()
        alert(j.error ?? '확정 실패')
        return
      }
      onDone()
    } finally {
      setConfirming(false)
    }
  }, [item.id, checking, onDone])

  const handleReject = useCallback(async () => {
    setRejecting(true)
    try {
      const res = await fetch(`/api/pricing/gpu/review/${item.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', rejected_reason: rejectReason || null }),
      })
      if (!res.ok) {
        const j = await res.json()
        alert(j.error ?? '반려 실패')
        return
      }
      onDone()
    } finally {
      setRejecting(false)
    }
  }, [item.id, rejectReason, onDone])

  const handleRecheck = useCallback(async () => {
    if (!feedback.trim()) { setRecheckErr('피드백을 입력해 주세요.'); return }
    setRechecking(true); setRecheckErr('')
    try {
      const res = await fetch(`/api/pricing/gpu/review/${item.id}/recheck`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback,
          original_text: extracted.original_text ?? '',
        }),
      })
      if (!res.ok) {
        const j = await res.json()
        setRecheckErr(j.error ?? 'AI 재분석 실패')
        return
      }
      setFeedback('')
      onDone()
    } finally {
      setRechecking(false)
    }
  }, [item.id, feedback, extracted.original_text, onDone])

  const impact = IMPACT_CONFIG[item.impact_level ?? 'steady'] ?? IMPACT_CONFIG.steady
  const overallPct = item.overall_confidence ?? 0

  return (
    <div className="gpu-rev-card" style={{ border: item.is_test ? '1px dashed #e0e7ff' : undefined }}>
      {/* 헤더 */}
      <div className="gpu-rev-top" style={{ alignItems: 'flex-start' }}>
        <div className="gpu-chip" style={{ width: 42, height: 42, flexShrink: 0 }}>
          {(item.product_hint ?? 'G').charAt(0)}
          <span style={{ fontSize: 9 }}>GPU</span>
        </div>
        <div className="gpu-rev-info" style={{ flex: 1 }}>
          <div className="gpu-rev-nm" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {item.product_hint ?? '모델 미인식'}
            {item.is_test && <span className="gpu-badge gpu-badge-gray">TEST</span>}
            <span
              className="gpu-badge"
              style={{ background: impact.color, color: '#fff', fontSize: 10 }}
            >
              {impact.label}
            </span>
            {item.current_iteration > 1 && (
              <span className="gpu-badge gpu-badge-t2" style={{ fontSize: 10 }}>
                {item.current_iteration}차 재분석
              </span>
            )}
          </div>
          <div className="gpu-rev-src" style={{ flexWrap: 'wrap', gap: 6 }}>
            {item.supplier_hint && <span>{item.supplier_hint}</span>}
            {item.channel && <span className="gpu-badge gpu-badge-gray">{item.channel}</span>}
            <span style={{ color: 'var(--gpu-faint)', fontSize: 11 }}>{new Date(item.created_at).toLocaleString('ko-KR')}</span>
          </div>
        </div>
        {/* 전체 신뢰도 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: overallPct >= 80 ? 'var(--gpu-green)' : overallPct >= 60 ? 'var(--gpu-amber)' : 'var(--gpu-red)', fontFamily: 'var(--font-mono, monospace)' }}>
            {overallPct}%
          </div>
          <div style={{ fontSize: 10, color: 'var(--gpu-muted)' }}>전체 신뢰도</div>
        </div>
      </div>

      {/* 추출 항목별 신뢰도 */}
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {CONF_FIELDS.map((f) => {
          const val = extracted[f]
          const conf = confidence[f]
          const isLow = conf != null && conf < 90
          const isChecked = checking.has(f)

          return (
            <div
              key={f}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                borderRadius: 8,
                background: isLow ? (isChecked ? '#f0fdf4' : '#fff7ed') : '#f9fafb',
                border: `1px solid ${isLow ? (isChecked ? '#bbf7d0' : '#fed7aa') : '#e5e7eb'}`,
              }}
            >
              {isLow ? (
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleCheck(f)}
                  style={{ width: 15, height: 15, accentColor: 'var(--gpu-green)', flexShrink: 0 }}
                />
              ) : (
                <CheckCircle2 size={15} style={{ color: 'var(--gpu-green)', flexShrink: 0 }} />
              )}
              <span style={{ minWidth: 72, fontSize: 12, color: 'var(--gpu-muted)' }}>{CONF_LABELS[f] ?? f}</span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#111827' }}>
                {val != null ? String(val) : <span style={{ color: 'var(--gpu-faint)', fontWeight: 400 }}>미인식</span>}
              </span>
              <ConfidenceBar value={conf ?? null} label="" />
            </div>
          )
        })}
      </div>

      {/* 낮은 신뢰도 안내 */}
      {lowConfFields.length > 0 && !allLowChecked && (
        <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa', fontSize: 12, color: '#92400e' }}>
          ⚠️ 신뢰도 90% 미만 항목이 있습니다. 각 항목을 직접 확인하고 체크해야 확정할 수 있습니다.
        </div>
      )}

      {/* 원본 추출 데이터 토글 */}
      <button
        style={{ marginTop: 12, fontSize: 12, color: 'var(--gpu-muted)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        전체 추출 데이터 {expanded ? '숨기기' : '보기'}
      </button>
      {expanded && (
        <pre style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8, background: '#f1f5f9', fontSize: 11, overflowX: 'auto', maxHeight: 200, color: '#374151', lineHeight: 1.6 }}>
          {JSON.stringify(extracted, null, 2)}
        </pre>
      )}

      {/* AI 재분석 섹션 */}
      <div style={{ marginTop: 14, padding: '12px', borderRadius: 8, background: '#f8faff', border: '1px solid #e0e7ff' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#4338ca', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
          <RotateCcw size={12} /> AI 재분석 요청
        </div>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="예) 단가가 월 단위인 것 같습니다. 시간당으로 환산해 주세요."
          style={{ width: '100%', minHeight: 60, padding: '7px 10px', borderRadius: 7, border: '1px solid #c7d2fe', fontSize: 12, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
        />
        {recheckErr && <div style={{ fontSize: 12, color: 'var(--gpu-red)', marginTop: 4 }}>{recheckErr}</div>}
        <button
          className="gpu-btn"
          style={{ marginTop: 6, fontSize: 12 }}
          onClick={handleRecheck}
          disabled={rechecking || !feedback.trim()}
        >
          {rechecking ? '재분석 중…' : 'AI 재분석'}
        </button>
      </div>

      {/* 액션 버튼 */}
      <div className="gpu-rev-actions" style={{ marginTop: 14 }}>
        <button
          className="gpu-btn gpu-btn-primary"
          onClick={handleConfirm}
          disabled={confirming || !canConfirm}
          title={!canConfirm ? '신뢰도 낮은 항목을 모두 확인 후 체크해 주세요' : ''}
          style={{ opacity: canConfirm ? 1 : 0.5 }}
        >
          {confirming ? '확정 중…' : '✓ 확정 · 가격표 반영'}
        </button>

        {!showReject ? (
          <button className="gpu-btn gpu-btn-danger" onClick={() => setShowReject(true)}>
            반려
          </button>
        ) : (
          <div style={{ display: 'flex', flex: 1, gap: 6 }}>
            <input
              type="text"
              placeholder="반려 사유 (선택)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              style={{ flex: 1, padding: '6px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12 }}
            />
            <button className="gpu-btn gpu-btn-danger" onClick={handleReject} disabled={rejecting}>
              {rejecting ? '처리 중…' : '반려 확정'}
            </button>
            <button className="gpu-btn" onClick={() => setShowReject(false)}>취소</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ReviewTab() {
  const { data, mutate: revalidate } = useSWR<{ items: ReviewItem[] }>(
    '/api/pricing/gpu/review?status=pending',
    fetcher
  )
  const items = data?.items ?? []

  const handleDone = useCallback(async () => {
    await revalidate()
    await globalMutate('/api/pricing/gpu/products')
    await globalMutate('/api/pricing/gpu/review?status=pending')
  }, [revalidate])

  return (
    <div>
      <div className="gpu-banner gpu-banner-warning">
        <div className="gpu-banner-dot">
          <AlertTriangle size={16} color="#d97706" />
        </div>
        <div>
          <strong>사람 검토 게이트</strong> · AI가 추출한 견적은 본부장 확정 전까지 가격표에 반영되지 않습니다.
          신뢰도 90% 미만 항목은 직접 확인 체크 후에만 확정 버튼이 활성화됩니다.
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--gpu-faint)', fontSize: '13px' }}>
          검토 대기 항목이 없습니다
        </div>
      ) : (
        items.map((item) => (
          <ReviewCard key={item.id} item={item} onDone={handleDone} />
        ))
      )}
    </div>
  )
}
