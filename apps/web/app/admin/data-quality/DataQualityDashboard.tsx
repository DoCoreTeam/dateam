'use client'

// app/admin/data-quality/DataQualityDashboard.tsx — 데이터 품질·신뢰도
//
// 표현만 표준으로 옮겼다(§2·§2-3): 카드는 `.card`, 제목은 PageHeader, 로딩은 SkelPage,
// "항목 없음"은 EmptyState. 조회(SWR)·조치 API는 그대로다.

import { useState } from 'react'
import useSWR from 'swr'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { SkelCard } from '@/components/ui/LoadingSkeleton'
import { fmtUSD } from '@/lib/gpu/format-price'

interface Metrics {
  review_items: { total: number; pending: number; confirmed: number; rejected: number; superseded: number; low_confidence: number }
  supply_quotes: { total: number; confirmed: number; avg_confidence: number | null; high: number; mid: number; low: number }
  anomaly_count: number
  validation_blocked: number
  dup_suspects: number
}
type MetricKey = 'anomaly' | 'low_confidence' | 'pending' | 'dup_suspects'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const TONE_COLOR = {
  bad: 'var(--danger)',
  warn: 'var(--warning)',
  ok: 'var(--success)',
  none: 'var(--text)',
} as const

function MetricCard({ label, value, sub, tone, onClick, active }: {
  label: string; value: string | number; sub?: string
  tone?: 'ok' | 'warn' | 'bad'; onClick?: () => void; active?: boolean
}) {
  const color = TONE_COLOR[tone ?? 'none']
  return (
    <div
      onClick={onClick}
      className="card"
      style={{
        padding: 'var(--space-4) var(--space-5)',
        minWidth: 0,
        cursor: onClick ? 'pointer' : 'default',
        borderColor: active ? 'var(--brand)' : undefined,
      }}
    >
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
        {label}
        {onClick && <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>클릭</span>}
      </div>
      <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)', marginTop: 'var(--space-2)' }}>{sub}</div>}
    </div>
  )
}

const DRILL_TITLE: Record<MetricKey, string> = {
  anomaly: '이상치 견적',
  low_confidence: '저신뢰 검토항목',
  pending: '검토 대기',
  dup_suspects: '중복 의심',
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

  // SkelPage는 `loading.tsx`용(스스로 page-inner를 연다). 화면 안에서 쓰면
  // MobileShell의 main.page-inner와 겹쳐 좌우 여백이 두 배가 됐다가 로드 후 되돌아온다.
  // 화면 내부 로딩은 헤더 + 골격만 그린다.
  if (isLoading || !m) {
    return (
      <div>
        <PageHeader
          title="데이터 품질 · 신뢰도"
          description="지표 카드를 클릭하면 상세 항목과 조치가 나타납니다 (30초 자동 갱신)"
        />
        <SkelCard lines={4} />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="데이터 품질 · 신뢰도"
        description="지표 카드를 클릭하면 상세 항목과 조치가 나타납니다 (30초 자동 갱신)"
      />

      <div className="responsive-grid-cols-4" style={{ marginBottom: 'var(--space-4)' }}>
        <MetricCard label="검증 게이트 차단(누계)" value={m.validation_blocked} sub="enum·범위·이상치 위반 차단" tone={m.validation_blocked > 0 ? 'warn' : 'ok'} />
        <MetricCard label="이상치(가격 밴드 밖)" value={m.anomaly_count} sub="확정 견적 상식범위 밖" tone={m.anomaly_count > 0 ? 'bad' : 'ok'} onClick={() => openDrill('anomaly')} active={drill === 'anomaly'} />
        <MetricCard label="저신뢰 검토항목" value={m.review_items.low_confidence} sub="신뢰도 60 미만" tone={m.review_items.low_confidence > 0 ? 'warn' : 'ok'} onClick={() => openDrill('low_confidence')} active={drill === 'low_confidence'} />
        <MetricCard label="중복 의심(검토대기)" value={m.dup_suspects} sub="동일 모델·신뢰도" tone={m.dup_suspects > 0 ? 'warn' : 'ok'} onClick={() => openDrill('dup_suspects')} active={drill === 'dup_suspects'} />
      </div>

      {/* 드릴다운 패널 */}
      {drill && (
        <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4) var(--space-5)' }} data-testid="drilldown-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
            <strong style={{ fontSize: 'var(--fs-base)', color: 'var(--text)' }}>{DRILL_TITLE[drill]} 상세</strong>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{items.length >= 100 ? '100건+' : `${items.length}건`}</span>
            {msg && <span style={{ marginLeft: 'var(--space-2)', fontSize: 'var(--fs-xs)', color: 'var(--success)' }}>{msg}</span>}
            <button type="button" onClick={() => setDrill(null)} className="btn-ghost" style={{ marginLeft: 'auto' }}>닫기 ✕</button>
          </div>

          {loadingItems ? <SkelCard lines={3} /> : items.length === 0 ? (
            <EmptyState title="해당 항목이 없어요" description="이 지표에서 조치할 항목이 남아 있지 않습니다" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: '360px', overflowY: 'auto' }}>
              {items.map((it, i) => (
                <div key={it.id ?? i} style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius)', backgroundColor: 'var(--color-surface)',
                  border: 'var(--hairline) solid var(--border-light)', fontSize: 'var(--fs-sm)',
                }}>
                  {drill === 'anomaly' && <>
                    <span style={{ fontWeight: 600, flex: 1 }}>{it.model_name} <span style={{ color: 'var(--text-faint)' }}>T{it.tier}</span></span>
                    <span style={{ fontWeight: 700, color: 'var(--danger)' }}>{fmtUSD(it.unit_price_usd)}/hr</span>
                    <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-2xs)' }}>{it.reason}</span>
                  </>}
                  {(drill === 'low_confidence' || drill === 'pending') && <>
                    <span style={{ fontWeight: 600, flex: 1 }}>{it.product_hint || '(미상)'} <span style={{ color: 'var(--text-faint)' }}>{it.supplier_hint || ''}</span></span>
                    {it.overall_confidence != null && <span style={{ color: it.overall_confidence < 60 ? 'var(--warning)' : 'var(--text-muted)' }}>신뢰도 {it.overall_confidence}</span>}
                    <button type="button" onClick={() => confirmItem(it.id)} className="btn-ghost" style={{ color: 'var(--success)', borderColor: 'var(--success-border)' }}>확정</button>
                    <button type="button" onClick={() => rejectItem(it.id)} className="btn-ghost" style={{ color: 'var(--danger)', borderColor: 'var(--danger-border)' }}>반려</button>
                  </>}
                  {drill === 'dup_suspects' && <>
                    <span style={{ fontWeight: 600, flex: 1 }}>{it.product_hint}</span>
                    <span style={{ color: 'var(--warning)' }}>{it.dup_count}건 중복</span>
                    <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-2xs)' }}>신뢰도 {it.overall_confidence ?? '—'}</span>
                    <button type="button" onClick={() => mergeDups(it)} className="btn-ghost" style={{ color: 'var(--brand)', borderColor: 'var(--brand)' }}>1건만 남기기</button>
                  </>}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-xs)' }}>
            <a href="/pricing/gpu?tab=review" style={{ color: 'var(--brand)' }}>→ 검토 대기 탭에서 전체 관리</a>
            {drill === 'anomaly' && <a href="/pricing/gpu?tab=board" style={{ color: 'var(--brand)', marginLeft: 'var(--space-4)' }}>→ 가격표에서 확인</a>}
          </div>
        </div>
      )}

      <h2 className="tape-title" style={{ margin: 'var(--space-2) 0 var(--space-3)' }}>검토 항목 (review_items)</h2>
      <div className="responsive-grid-cols-4" style={{ marginBottom: 'var(--space-6)' }}>
        <MetricCard label="전체" value={m.review_items.total} />
        <MetricCard label="검토 대기" value={m.review_items.pending} tone={m.review_items.pending > 0 ? 'warn' : 'ok'} sub="클릭→상세" onClick={() => openDrill('pending')} active={drill === 'pending'} />
        <MetricCard label="확정" value={m.review_items.confirmed} tone="ok" />
        <MetricCard label="반려" value={m.review_items.rejected} />
      </div>

      <h2 className="tape-title" style={{ margin: 'var(--space-2) 0 var(--space-3)' }}>공급 견적 신뢰도 (supply_quotes)</h2>
      <div className="responsive-grid-cols-4" style={{ marginBottom: 'var(--space-6)' }}>
        <MetricCard label="평균 신뢰도" value={m.supply_quotes.avg_confidence != null ? `${m.supply_quotes.avg_confidence}%` : '—'} tone={(m.supply_quotes.avg_confidence ?? 0) >= 80 ? 'ok' : 'warn'} />
        <MetricCard label="高 (≥90)" value={m.supply_quotes.high} tone="ok" sub="자동 신뢰 후보" />
        <MetricCard label="中 (60~89)" value={m.supply_quotes.mid} tone="warn" sub="검토 권장" />
        <MetricCard label="低 (<60)" value={m.supply_quotes.low} tone={m.supply_quotes.low > 0 ? 'bad' : 'ok'} sub="저신뢰 — 재확인" />
      </div>
    </div>
  )
}
