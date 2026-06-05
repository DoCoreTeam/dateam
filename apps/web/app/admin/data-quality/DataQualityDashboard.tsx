'use client'
import useSWR from 'swr'

interface Metrics {
  review_items: { total: number; pending: number; confirmed: number; rejected: number; superseded: number; low_confidence: number }
  supply_quotes: { total: number; confirmed: number; avg_confidence: number | null; high: number; mid: number; low: number }
  anomaly_count: number
  validation_blocked: number
  dup_suspects: number
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function Card({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? '#dc2626' : tone === 'warn' ? '#d97706' : tone === 'ok' ? '#16a34a' : '#0f172a'
  return (
    <div style={{ padding: '16px 18px', borderRadius: 12, background: '#fff', border: '1px solid #e5e7eb', minWidth: 0 }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

export default function DataQualityDashboard() {
  const { data, isLoading } = useSWR<{ metrics: Metrics }>('/api/admin/data-quality', fetcher, { refreshInterval: 30000 })
  const m = data?.metrics

  return (
    <div className="page-inner" style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ marginBottom: 4, fontSize: 12, color: '#64748b' }}>관리자 · 데이터 품질</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: '0 0 4px' }}>데이터 품질 · 신뢰도</h2>
      <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 18px' }}>AI 추출 파이프라인의 정합성·신뢰도 지표 (30초 자동 갱신)</p>

      {isLoading || !m ? (
        <div style={{ color: '#94a3b8', fontSize: 13, padding: 40, textAlign: 'center' }}>불러오는 중…</div>
      ) : (
        <>
          {/* 핵심 위험 지표 */}
          <div className="responsive-grid-cols-4" style={{ marginBottom: 20 }}>
            <Card label="검증 게이트 차단(누계)" value={m.validation_blocked} sub="enum·범위·이상치 위반으로 저장 차단" tone={m.validation_blocked > 0 ? 'warn' : 'ok'} />
            <Card label="이상치(가격 밴드 밖)" value={m.anomaly_count} sub="확정 견적 중 tier 상식범위 벗어남" tone={m.anomaly_count > 0 ? 'bad' : 'ok'} />
            <Card label="저신뢰 검토항목" value={m.review_items.low_confidence} sub="신뢰도 60 미만" tone={m.review_items.low_confidence > 0 ? 'warn' : 'ok'} />
            <Card label="중복 의심(검토대기)" value={m.dup_suspects} sub="동일 모델·신뢰도 중복" tone={m.dup_suspects > 0 ? 'warn' : 'ok'} />
          </div>

          {/* 검토 항목 상태 */}
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#334155', margin: '8px 0 10px' }}>검토 항목 (review_items)</h3>
          <div className="responsive-grid-cols-4" style={{ marginBottom: 20 }}>
            <Card label="전체" value={m.review_items.total} />
            <Card label="검토 대기" value={m.review_items.pending} tone={m.review_items.pending > 0 ? 'warn' : 'ok'} sub="확인 필요 적체" />
            <Card label="확정" value={m.review_items.confirmed} tone="ok" />
            <Card label="반려" value={m.review_items.rejected} />
          </div>

          {/* 공급 견적 신뢰도 */}
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#334155', margin: '8px 0 10px' }}>공급 견적 신뢰도 (supply_quotes)</h3>
          <div className="responsive-grid-cols-4" style={{ marginBottom: 20 }}>
            <Card label="평균 신뢰도" value={m.supply_quotes.avg_confidence != null ? `${m.supply_quotes.avg_confidence}%` : '—'} tone={(m.supply_quotes.avg_confidence ?? 0) >= 80 ? 'ok' : 'warn'} />
            <Card label="高 (≥90)" value={m.supply_quotes.high} tone="ok" sub="자동 신뢰 후보" />
            <Card label="中 (60~89)" value={m.supply_quotes.mid} tone="warn" sub="검토 권장" />
            <Card label="低 (<60)" value={m.supply_quotes.low} tone={m.supply_quotes.low > 0 ? 'bad' : 'ok'} sub="저신뢰 — 재확인" />
          </div>
        </>
      )}
    </div>
  )
}
