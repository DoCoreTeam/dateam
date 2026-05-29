'use client'

import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'

interface AuditLog {
  id: string
  ts: string
  actor: string | null
  action_type: string
  detail: Record<string, unknown> | null
  evidence_ref: string | null
  gpu_products: { model_name: string; memory: string; tier: number } | null
}

const ACTION_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  quote_registered:        { label: '견적 등록',     color: '#2563eb', bg: '#e8f0ff' },
  quote_confirmed:         { label: '견적 확정',     color: '#15a35a', bg: '#e6f7ee' },
  lowest_changed:          { label: '최저가 변경',   color: '#5b5ef0', bg: '#eef0fe' },
  expired:                 { label: '만료',          color: '#e0405a', bg: '#fdebee' },
  direct_set:              { label: '판매가 직접설정', color: '#d97706', bg: '#fef3e2' },
  margin_changed:          { label: '마진 변경',     color: '#7c3aed', bg: '#f1ebfe' },
  rejected:                { label: '반려',          color: '#6b7280', bg: '#f0f1f4' },
  // AI 리뷰 게이트
  review_created:          { label: 'AI 분석 등록',  color: '#4338ca', bg: '#eef2ff' },
  review_finalized:        { label: '검토 확정',     color: '#15a35a', bg: '#e6f7ee' },
  review_rejected:         { label: '검토 반려',     color: '#dc2626', bg: '#fee2e2' },
  review_recheck_completed:{ label: 'AI 재분석',     color: '#0891b2', bg: '#e0f7fa' },
  // 풀 재고 / 가용량
  pool_stock_changed:      { label: 'T3 재고 변경',  color: '#b45309', bg: '#fef3e2' },
  availability_registered: { label: '가용량 등록',   color: '#0d9488', bg: '#f0fdfa' },
  inquiry_sent:            { label: '문의 발송',     color: '#0ea5e9', bg: '#f0f9ff' },
}

export default function HistoryTab() {
  const { data } = useSWR<{ logs: AuditLog[] }>('/api/pricing/gpu/audit', fetcher)
  const logs = data?.logs ?? []

  return (
    <div>
      <div className="gpu-toolbar">
        <div className="gpu-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
          <input placeholder="이력 검색 (모델·공급사·작업)" readOnly />
        </div>
        <div className="gpu-seg">
          <button className="on">전체</button>
          <button>최저가 변경</button>
          <button>등록/수정</button>
          <button>만료</button>
        </div>
      </div>

      <div className="gpu-panel gpu-card-pad">
        {logs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--gpu-faint)', fontSize: '13px' }}>
            변동 이력이 없습니다
          </div>
        ) : (
          logs.map((log) => {
            const cfg = ACTION_CONFIG[log.action_type] ?? { label: log.action_type, color: '#6b7280', bg: '#f0f1f4' }
            const product = log.gpu_products
            const ts = new Date(log.ts)

            return (
              <div key={log.id} className="gpu-log-item">
                <div className="gpu-log-time">
                  <div>{ts.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}</div>
                  <div>{ts.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <div className="gpu-log-ico" style={{ background: cfg.bg }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={cfg.color} strokeWidth="2.2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                </div>
                <div className="gpu-log-body">
                  <div className="gpu-log-ttl">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: cfg.bg, color: cfg.color, fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6 }}>
                      {cfg.label}
                    </span>
                    {product && (
                      <span className="gpu-mono" style={{ color: 'var(--gpu-accent-ink)', marginLeft: 8 }}>
                        {product.model_name} {product.memory}
                      </span>
                    )}
                  </div>
                  {log.detail && (
                    <div className="gpu-log-dsc">
                      {log.action_type === 'margin_changed' && `마진 → ${(log.detail as Record<string, unknown>).margin_pct}%`}
                      {log.action_type === 'quote_registered' && `단가 $${(log.detail as Record<string, unknown>).unit_price_usd}/hr`}
                      {log.action_type === 'direct_set' && `판매가 ₩${Number((log.detail as Record<string, unknown>).sell_price_krw).toLocaleString()}/hr`}
                      {log.action_type === 'review_created' && `신뢰도 ${(log.detail as Record<string, unknown>).overall_confidence}%`}
                      {log.action_type === 'review_finalized' && `단가 $${(log.detail as Record<string, unknown>).unit_price_usd}/hr · 신뢰도 ${(log.detail as Record<string, unknown>).overall_confidence}%`}
                      {log.action_type === 'review_rejected' && ((log.detail as Record<string, unknown>).reason as string | null ?? '사유 없음')}
                      {log.action_type === 'review_recheck_completed' && `${(log.detail as Record<string, unknown>).iteration_no}차 재분석 · 신뢰도 ${(log.detail as Record<string, unknown>).overall_confidence}%`}
                      {log.action_type === 'pool_stock_changed' && `풀 재고 → ${(log.detail as Record<string, unknown>).pool_qty}대`}
                      {log.action_type === 'availability_registered' && `상태: ${(log.detail as Record<string, unknown>).status} · ${(log.detail as Record<string, unknown>).resp_qty ?? '—'}대`}
                    </div>
                  )}
                  <div className="gpu-log-actor">
                    {log.actor && <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>{log.actor}</>}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
