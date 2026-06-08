'use client'
import { useState } from 'react'
import useSWR from 'swr'

interface Metrics {
  review_items: { total: number; pending: number; confirmed: number; rejected: number; superseded: number; low_confidence: number }
  supply_quotes: { total: number; confirmed: number; avg_confidence: number | null; high: number; mid: number; low: number }
  anomaly_count: number
  validation_blocked: number
  dup_suspects: number
}
type MetricKey = 'anomaly' | 'low_confidence' | 'pending' | 'dup_suspects'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function Card({ label, value, sub, tone, onClick, active }: { label: string; value: string | number; sub?: string; tone?: 'ok' | 'warn' | 'bad'; onClick?: () => void; active?: boolean }) {
  const color = tone === 'bad' ? 'var(--danger)' : tone === 'warn' ? 'var(--warning)' : tone === 'ok' ? 'var(--success)' : 'var(--text)'
  return (
    <div onClick={onClick} style={{ padding: '16px 18px', borderRadius: 12, background: '#fff', border: `1px solid ${active ? 'var(--gpu-accent,var(--brand))' : 'var(--color-border)'}`, minWidth: 0, cursor: onClick ? 'pointer' : 'default', boxShadow: active ? '0 0 0 2px rgba(91,94,240,.15)' : 'none' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>{label}{onClick && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--border-subtle)' }}>클릭</span>}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

export default function DataQualityDashboard() {
  const { data, isLoading, mutate } = useSWR<{ metrics: Metrics }>('/api/admin/data-quality', fetcher, { refreshInterval: 30000 })
  const m = data?.metrics
  const [drill, setDrill] = useState<MetricKey | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [items, setItems] = useState<any[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [msg, setMsg] = useState('')

  const openDrill = async (metric: MetricKey) => {
    if (drill === metric) { setDrill(null); return }
    setDrill(metric); setLoadingItems(true); setItems([]); setMsg('')
    try {
      const r = await fetch(`/api/admin/data-quality/drilldown?metric=${metric}`)
      const j = await r.json()
      setItems(j.items ?? [])
    } finally { setLoadingItems(false) }
  }

  // 기존 review/[id] 엔드포인트 재사용 (단일구현 정책 — 신규 merge/confirm API 만들지 않음)
  const reviewAction = (id: string, action: 'reject' | 'confirm') =>
    fetch(`/api/pricing/gpu/review/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, rejected_reason: action === 'reject' ? '데이터 품질 점검 — 반려' : undefined }) })

  const rejectItem = async (id: string) => {
    if (!confirm('이 항목을 반려할까요?')) return
    const r = await reviewAction(id, 'reject')
    if (r.ok) { setItems((p) => p.filter((it) => it.id !== id)); setMsg('반려 완료'); mutate() }
    else { const j = await r.json().catch(() => ({})); setMsg(j.error ?? '반려 실패') }
  }

  const confirmItem = async (id: string) => {
    if (!confirm('이 항목을 확정할까요?')) return
    const r = await reviewAction(id, 'confirm')
    if (r.ok) { setItems((p) => p.filter((it) => it.id !== id)); setMsg('확정 완료'); mutate() }
    else { const j = await r.json().catch(() => ({})); setMsg(j.error ?? '확정 실패') }
  }

  // 중복 정리: 그룹의 첫 건만 남기고 나머지 reject (기존 reject API 반복 — 단일구현)
  const mergeDups = async (group: { product_hint: string; ids: string[] }) => {
    const dupes = (group.ids ?? []).slice(1)
    if (dupes.length === 0) return
    if (!confirm(`"${group.product_hint}" 중복 ${dupes.length}건을 반려하고 1건만 남길까요?`)) return
    const results = await Promise.all(dupes.map((id) => reviewAction(id, 'reject')))
    const ok = results.filter((r) => r.ok).length
    setMsg(`${ok}/${dupes.length}건 정리 완료`); mutate()
    // 부분 실패 시 UI가 실제 DB 상태를 반영하도록 재조회(낙관적 제거 대신 — DC-REV M)
    const r = await fetch(`/api/admin/data-quality/drilldown?metric=dup_suspects`)
    setItems((await r.json()).items ?? [])
  }

  return (
    <div className="page-inner" style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ marginBottom: 4, fontSize: 12, color: 'var(--text-muted)' }}>관리자 · 데이터 품질</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>데이터 품질 · 신뢰도</h2>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 18px' }}>지표 카드를 클릭하면 상세 항목과 조치가 나타납니다 (30초 자동 갱신)</p>

      {isLoading || !m ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: 40, textAlign: 'center' }}>불러오는 중…</div>
      ) : (
        <>
          <div className="responsive-grid-cols-4" style={{ marginBottom: 16 }}>
            <Card label="검증 게이트 차단(누계)" value={m.validation_blocked} sub="enum·범위·이상치 위반 차단" tone={m.validation_blocked > 0 ? 'warn' : 'ok'} />
            <Card label="이상치(가격 밴드 밖)" value={m.anomaly_count} sub="확정 견적 상식범위 밖" tone={m.anomaly_count > 0 ? 'bad' : 'ok'} onClick={() => openDrill('anomaly')} active={drill === 'anomaly'} />
            <Card label="저신뢰 검토항목" value={m.review_items.low_confidence} sub="신뢰도 60 미만" tone={m.review_items.low_confidence > 0 ? 'warn' : 'ok'} onClick={() => openDrill('low_confidence')} active={drill === 'low_confidence'} />
            <Card label="중복 의심(검토대기)" value={m.dup_suspects} sub="동일 모델·신뢰도" tone={m.dup_suspects > 0 ? 'warn' : 'ok'} onClick={() => openDrill('dup_suspects')} active={drill === 'dup_suspects'} />
          </div>

          {/* 드릴다운 패널 */}
          {drill && (
            <div style={{ marginBottom: 22, padding: '14px 16px', borderRadius: 12, background: 'var(--color-bg)', border: '2px solid var(--border-color)' }} data-testid="drilldown-panel">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <strong style={{ fontSize: 14, color: 'var(--text)' }}>
                  {drill === 'anomaly' ? '이상치 견적' : drill === 'low_confidence' ? '저신뢰 검토항목' : drill === 'pending' ? '검토 대기' : '중복 의심'} 상세
                </strong>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{items.length >= 100 ? '100건+' : `${items.length}건`}</span>
                {msg && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--success)' }}>{msg}</span>}
                <button onClick={() => setDrill(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 13 }}>닫기 ✕</button>
              </div>
              {loadingItems ? <div style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>불러오는 중…</div> : items.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>해당 항목 없음 ✓</div> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
                  {items.map((it, i) => (
                    <div key={it.id ?? i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderRadius: 8, background: '#fff', border: '1px solid var(--surface-bg)', fontSize: 12.5 }}>
                      {drill === 'anomaly' && <>
                        <span style={{ fontWeight: 600, flex: 1 }}>{it.model_name} <span style={{ color: 'var(--text-faint)' }}>T{it.tier}</span></span>
                        <span style={{ fontWeight: 700, color: 'var(--danger)' }}>${it.unit_price_usd}/hr</span>
                        <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{it.reason}</span>
                      </>}
                      {(drill === 'low_confidence' || drill === 'pending') && <>
                        <span style={{ fontWeight: 600, flex: 1 }}>{it.product_hint || '(미상)'} <span style={{ color: 'var(--text-faint)' }}>{it.supplier_hint || ''}</span></span>
                        {it.overall_confidence != null && <span style={{ color: it.overall_confidence < 60 ? 'var(--warning)' : 'var(--text-muted)' }}>신뢰도 {it.overall_confidence}</span>}
                        <button onClick={() => confirmItem(it.id)} className="gpu-btn" style={{ fontSize: 11, padding: '3px 10px', color: 'var(--success)', borderColor: 'var(--success-border)' }}>확정</button>
                        <button onClick={() => rejectItem(it.id)} className="gpu-btn" style={{ fontSize: 11, padding: '3px 10px', color: 'var(--danger)', borderColor: 'var(--danger-border)' }}>반려</button>
                      </>}
                      {drill === 'dup_suspects' && <>
                        <span style={{ fontWeight: 600, flex: 1 }}>{it.product_hint}</span>
                        <span style={{ color: 'var(--warning)' }}>{it.dup_count}건 중복</span>
                        <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>신뢰도 {it.overall_confidence ?? '—'}</span>
                        <button onClick={() => mergeDups(it)} className="gpu-btn" style={{ fontSize: 11, padding: '3px 10px', color: 'var(--gpu-accent,var(--brand))', borderColor: 'var(--brand-soft-2)' }}>1건만 남기기</button>
                      </>}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 10, fontSize: 11.5 }}>
                <a href="/pricing/gpu?tab=review" style={{ color: 'var(--gpu-accent,var(--brand))' }}>→ 검토 대기 탭에서 전체 관리</a>
                {drill === 'anomaly' && <a href="/pricing/gpu?tab=board" style={{ color: 'var(--gpu-accent,var(--brand))', marginLeft: 16 }}>→ 가격표에서 확인</a>}
              </div>
            </div>
          )}

          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '8px 0 10px' }}>검토 항목 (review_items)</h3>
          <div className="responsive-grid-cols-4" style={{ marginBottom: 20 }}>
            <Card label="전체" value={m.review_items.total} />
            <Card label="검토 대기" value={m.review_items.pending} tone={m.review_items.pending > 0 ? 'warn' : 'ok'} sub="클릭→상세" onClick={() => openDrill('pending')} active={drill === 'pending'} />
            <Card label="확정" value={m.review_items.confirmed} tone="ok" />
            <Card label="반려" value={m.review_items.rejected} />
          </div>

          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '8px 0 10px' }}>공급 견적 신뢰도 (supply_quotes)</h3>
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
