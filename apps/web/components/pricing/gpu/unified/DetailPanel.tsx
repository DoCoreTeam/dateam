'use client'

// 통합 표 — 우측 고정 상세 패널 (마스터·디테일). 인라인 드로어 금지(목록 맥락 유지).
// 탭: 공급원가(전체 견적) / 시장 비교 / 변동 이력 / 스펙.
//   - 공급원가·변동 이력은 product_id로 P5 읽기 API 연결(전체 견적·감사 필터).
//   - 시세 이력(시계열)은 mapping_id 의존 → 시장 비교 탭은 요약 + 안내(후속 P2b).
// 데이터·계산은 기존 SSOT/라우트 재사용. 본 컴포넌트는 fetch+표현만.

import { useState } from 'react'
import useSWR from 'swr'
import dynamic from 'next/dynamic'
import { fetcher } from '@/lib/swr-config'
import { GPU_TERMS } from '@/lib/gpu/terms'
import { fmtMoneyFromKrw, fmtMoneyFromUsd } from '@/lib/gpu/format-price'
import type { CurrencyCtx } from '@/lib/gpu/unified-row'
import { expiryState } from '@/lib/gpu/expiry'
import { auditActionLabel } from '@/lib/gpu/audit-labels'
import { tierName } from '@/lib/gpu/unified-row'
import type { UnifiedRow } from '@/lib/gpu/unified-row'
import type { QuoteForEdit } from '@/components/pricing/gpu/QuoteEditModal'
import type { MarketPriceForEdit } from '@/components/pricing/gpu/MarketPriceEditModal'

const QuoteEditModal = dynamic(() => import('@/components/pricing/gpu/QuoteEditModal'), { ssr: false })
const MarketPriceEditModal = dynamic(() => import('@/components/pricing/gpu/MarketPriceEditModal'), { ssr: false })

type DetailTab = 'cost' | 'market' | 'history' | 'specs'

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'cost', label: GPU_TERMS.supplyCost },
  { id: 'market', label: '시장 비교' },
  { id: 'history', label: '변동 이력' },
  { id: 'specs', label: '스펙' },
]

interface QuoteRow {
  id: string
  unit_price_usd: number | null
  gpu_count: number | null
  min_qty: string | null
  term: string | null
  status: string | null
  valid_until: string | null
  suppliers?: { name?: string | null; color?: string | null; logo_url?: string | null } | null
}
interface AuditRow {
  ts: string
  actor: string | null
  action_type: string
}
interface MarketPriceRow {
  id: string
  price_usd: number | null
  recorded_at: string | null
}

interface DetailPanelProps {
  row: UnifiedRow | null
  /** 표시 통화 — 좌측 목록과 동일 모드를 따른다(₩/$ 일관). */
  currency?: CurrencyCtx
  /** 실견적 등록 — 기존 통합 입력 플로우로 이동(부모가 탭 전환). */
  onRegisterQuote?: () => void
  /** 매핑 관리 — 기존 경쟁사 매핑 관리 화면으로 이동(부모가 탭 전환). */
  onManageMapping?: () => void
}

export default function DetailPanel({ row, currency = { mode: 'KRW', usdKrw: 1 }, onRegisterQuote, onManageMapping }: DetailPanelProps) {
  const mKrw = (krw: number | null) => fmtMoneyFromKrw(krw, currency.mode, currency.usdKrw)
  const mUsd = (usd: number | null) => fmtMoneyFromUsd(usd, currency.mode, currency.usdKrw)
  const [tab, setTab] = useState<DetailTab>('cost')
  const [editing, setEditing] = useState<QuoteForEdit | null>(null)
  const [marketEdit, setMarketEdit] = useState<MarketPriceForEdit | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  // 가격 동기화 — 기존 sync-cost 라우트 재사용(저장 출처 재수집→공급원가 반영). 전역 1버튼.
  async function runSync() {
    setSyncing(true); setSyncMsg(null)
    try {
      const res = await fetch('/api/pricing/gpu/market/sync-cost', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setSyncMsg(j.error ?? '동기화 실패'); return }
      setSyncMsg(`동기화 완료 — 검토 대기 ${j.created ?? 0}건 생성`)
    } catch {
      setSyncMsg('동기화 중 오류가 발생했습니다.')
    } finally {
      setSyncing(false)
    }
  }

  // 공급원가: 전체 견적(확정·검토 대기·만료·반려) — P5-1
  const { data: quoteData, isLoading: quoteLoading, mutate: mutateQuotes } = useSWR<{ quotes: QuoteRow[] }>(
    row && tab === 'cost' ? `/api/pricing/gpu/quotes?product_id=${row.id}&status=*` : null,
    fetcher,
  )
  // 변동 이력: product 필터 — P5-4
  const { data: auditData, isLoading: auditLoading } = useSWR<{ logs: AuditRow[] }>(
    row && tab === 'history' ? `/api/pricing/gpu/audit?product_id=${row.id}&limit=50` : null,
    fetcher,
  )
  // 시세 이력(시계열): mapping_id 있을 때만 — P5-2
  const { data: priceHistData, mutate: mutatePriceHist } = useSWR<{ prices: MarketPriceRow[] }>(
    row && tab === 'market' && row.market_mapping_id
      ? `/api/pricing/gpu/market/prices?mapping_id=${row.market_mapping_id}&limit=30`
      : null,
    fetcher,
  )
  // 시장가 수정 대상 = 첫 매핑의 최신 시세 행(시장가 수정 모달은 price_usd·notes만 편집).
  const latestMarketPrice = priceHistData?.prices?.[0] ?? null

  if (!row) {
    return (
      <div className="gpu-udetail gpu-udetail--empty">
        <p className="gpu-udetail-empty-msg">왼쪽 목록에서 항목을 선택하세요.</p>
      </div>
    )
  }

  return (
    <div className="gpu-udetail">
      <div className="gpu-udetail-head">
        <div className="gpu-udetail-title">
          {row.model_name}
          {row.tier != null && <span className="gpu-ubadge gpu-ubadge--muted">{tierName(row.tier)}</span>}
          <span className={`gpu-ubadge gpu-ubadge--${row.cost_source === 'market_link' ? 'warn' : 'default'}`}>
            {row.cost_source === 'market_link' ? GPU_TERMS.followPrice : row.cost_source === 'direct' ? '직접설정' : GPU_TERMS.realQuote}
          </span>
        </div>
        <div className="gpu-udetail-sub">
          {row.memory ?? '—'} · {GPU_TERMS.sellPrice} <strong>{mKrw(row.sell_price_krw)}</strong>
          {' · '}
          {GPU_TERMS.margin} {row.margin_pct == null ? '측정불가' : `+${row.margin_pct.toFixed(0)}%`}
        </div>
      </div>

      <div className="gpu-udetail-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`gpu-udetail-tab${tab === t.id ? ' gpu-udetail-tab--on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="gpu-udetail-body">
        {tab === 'cost' && (
          <>
            <div className="gpu-udetail-kv">
              <span className="gpu-udetail-kv-k">{GPU_TERMS.lowestSupplyCost}</span>
              {/* 판매가가 있으면 공급원가 기준도 항상 표시: 실견적/전파 cost가 없으면 공시가(list)로 폴백 — 정합성 */}
              <span className="gpu-udetail-kv-v">{mKrw(costBasisKrw(row))}</span>
            </div>
            <div className="gpu-udetail-kv">
              <span className="gpu-udetail-kv-k">출처</span>
              <span className="gpu-udetail-kv-v">{basisSourceLabel(row)}</span>
            </div>
            {quoteLoading && <p className="gpu-udetail-pending">불러오는 중…</p>}
            {!quoteLoading && (
              <table className="gpu-udetail-tbl">
                <thead>
                  <tr><th>{GPU_TERMS.supplier}</th><th>단가</th><th>약정</th><th>상태</th><th>만료</th><th></th></tr>
                </thead>
                <tbody>
                  {(quoteData?.quotes ?? []).map((q) => {
                    const exp = expiryInfo(q.valid_until)
                    return (
                      <tr key={q.id}>
                        <td><SupplierCell name={q.suppliers?.name ?? null} color={q.suppliers?.color ?? null} logoUrl={q.suppliers?.logo_url ?? null} /></td>
                        <td className="gpu-mono">{mUsd(q.unit_price_usd)}</td>
                        <td>{q.term ?? '—'}</td>
                        <td>{statusLabel(q.status)}</td>
                        <td>
                          {q.valid_until ?? '—'}
                          {exp && <span className={`gpu-badge ${exp.tone === 'danger' ? 'gpu-badge-danger' : 'gpu-badge-warn'}`}>{exp.label}</span>}
                        </td>
                        <td>
                          {q.unit_price_usd != null && (
                            <button
                              type="button"
                              className="gpu-udetail-rowbtn"
                              onClick={() => setEditing({
                                id: q.id,
                                unit_price_usd: q.unit_price_usd as number,
                                gpu_count: q.gpu_count ?? 1,
                                term: q.term,
                                min_qty: q.min_qty,
                                valid_until: q.valid_until,
                                supplier_name: q.suppliers?.name ?? null,
                              })}
                            >
                              {GPU_TERMS.edit}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {(quoteData?.quotes?.length ?? 0) === 0 && (
                    <tr><td colSpan={6} className="gpu-udetail-tbl-empty">
                      {row.sell_price_krw != null
                        ? `직접 견적 없음 — ${basisSourceLabel(row)} 기준으로 판매가 산정됨`
                        : GPU_TERMS.emptyList}
                    </td></tr>
                  )}
                </tbody>
              </table>
            )}
            {/* 견적 수정·삭제는 각 견적 행의 '수정' 버튼(QuoteEditModal에 삭제 포함)에서 처리.
                여기서는 신규 실견적 등록만 — 기존 통합 입력 플로우로 연결(부모 콜백). */}
            {onRegisterQuote && (
              <div className="gpu-udetail-acts">
                <button type="button" className="gpu-udetail-rowbtn" onClick={onRegisterQuote}>실견적 {GPU_TERMS.create}</button>
              </div>
            )}
          </>
        )}

        {tab === 'market' && (
          <>
            <div className="gpu-udetail-kv">
              <span className="gpu-udetail-kv-k">중앙값</span>
              <span className="gpu-udetail-kv-v">{mKrw(row.market_median_krw)}</span>
            </div>
            <div className="gpu-udetail-kv">
              <span className="gpu-udetail-kv-k">최저~최고</span>
              <span className="gpu-udetail-kv-v">{mKrw(row.market_min_krw)} ~ {mKrw(row.market_max_krw)}</span>
            </div>
            <div className="gpu-udetail-kv">
              <span className="gpu-udetail-kv-k">표본</span>
              <span className="gpu-udetail-kv-v">{row.sample_count != null ? `${row.sample_count}곳` : '—'}</span>
            </div>
            {/* 경쟁사 횡단 비교(회사명+시장가+수집일) — 기획서 시장 비교 표. cockpit competitors[] 재사용. */}
            <table className="gpu-udetail-tbl">
              <thead><tr><th>{GPU_TERMS.competitor}</th><th>{GPU_TERMS.marketPrice}</th><th>수집일</th></tr></thead>
              <tbody>
                {row.competitors.map((c, i) => (
                  <tr key={`${c.company_name}-${i}`}>
                    <td>{c.company_name}</td>
                    <td className="gpu-mono">{mKrw(c.price_krw)}</td>
                    <td className="gpu-mono">{c.recorded_at ? formatTs(c.recorded_at) : '—'}</td>
                  </tr>
                ))}
                {row.competitors.length === 0 && (
                  <tr><td colSpan={3} className="gpu-udetail-tbl-empty">연결된 경쟁사가 없습니다. 매핑 관리에서 연결하세요.</td></tr>
                )}
              </tbody>
            </table>
            <div className="gpu-udetail-acts">
              {onManageMapping && (
                <button type="button" className="gpu-udetail-rowbtn" onClick={onManageMapping}>매핑 관리</button>
              )}
              <button
                type="button"
                className="gpu-udetail-rowbtn"
                disabled={!latestMarketPrice}
                onClick={() => {
                  if (!latestMarketPrice) return
                  setMarketEdit({
                    price_id: latestMarketPrice.id,
                    price_usd: latestMarketPrice.price_usd ?? 0,
                    competitor_name: row.competitors[0]?.company_name ?? GPU_TERMS.competitor,
                    sku: '',
                    pricing_model: 'on_demand',
                    notes: null,
                  })
                }}
              >
                {GPU_TERMS.marketPrice} {GPU_TERMS.edit}
              </button>
              <button
                type="button"
                className="gpu-udetail-rowbtn"
                disabled={syncing}
                onClick={runSync}
              >
                {syncing ? '동기화 중…' : GPU_TERMS.sync}
              </button>
            </div>
            {syncMsg && <p className="gpu-udetail-pending">{syncMsg}</p>}
          </>
        )}

        {tab === 'history' && (
          <>
            {auditLoading && <p className="gpu-udetail-pending">불러오는 중…</p>}
            {!auditLoading && (
              <table className="gpu-udetail-tbl">
                <thead><tr><th>일자</th><th>동작</th><th>작업자</th></tr></thead>
                <tbody>
                  {(auditData?.logs ?? []).map((a, i) => (
                    <tr key={`${a.ts}-${i}`}>
                      <td className="gpu-mono">{formatTs(a.ts)}</td>
                      <td>{auditActionLabel(a.action_type)}</td>
                      <td>{a.actor ?? '—'}</td>
                    </tr>
                  ))}
                  {(auditData?.logs?.length ?? 0) === 0 && (
                    <tr><td colSpan={3} className="gpu-udetail-tbl-empty">{GPU_TERMS.emptyList}</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === 'specs' && (
          <>
            <div className="gpu-udetail-kv">
              <span className="gpu-udetail-kv-k">{GPU_TERMS.model}</span>
              <span className="gpu-udetail-kv-v">{row.model_name}</span>
            </div>
            <div className="gpu-udetail-kv">
              <span className="gpu-udetail-kv-k">메모리</span>
              <span className="gpu-udetail-kv-v">{row.memory ?? '—'}</span>
            </div>
            <p className="gpu-udetail-pending">상세 스펙(vCPU·RAM·스토리지)은 스펙 관리 연동 후 표시됩니다.</p>
          </>
        )}
      </div>

      {editing && row && (
        <QuoteEditModal
          quote={editing}
          productId={row.id}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); mutateQuotes() }}
        />
      )}

      {marketEdit && (
        <MarketPriceEditModal
          price={marketEdit}
          onClose={() => setMarketEdit(null)}
          onSaved={() => { setMarketEdit(null); mutatePriceHist() }}
        />
      )}
    </div>
  )
}

/** 공급원가 기준값: 실견적/전파 cost 우선. 없고 판매가가 있으면(공시가 기반) 공시가 = 판매가 그 자체를 기준으로 표시.
 *  → "판매가가 있는데 공급원가가 비어 보이는" 정합성 깨짐 방지. (공시가는 원가·마진 분해가 없어 판매가=기준) */
function costBasisKrw(row: UnifiedRow): number | null {
  if (row.supply_cost_krw != null) return row.supply_cost_krw
  if (row.sell_price_krw != null) return row.list_price_krw ?? row.sell_price_krw
  return null
}

/** 공급원가 출처 라벨: 추종가/전파 추정/공시가/실견적. */
function basisSourceLabel(row: UnifiedRow): string {
  if (row.cost_source === 'market_link') return GPU_TERMS.followPrice
  switch (row.basis) {
    case 'propagated': return '전파 추정'
    case 'list': return '공시가(gcube)'
    case 'none': return row.sell_price_krw != null ? '공시가(gcube)' : '—'
    default: return GPU_TERMS.realQuote
  }
}

/** 공급사 셀 — 로고(logo_url) + 이름. 로고 없거나 로드 실패 시 색 글자 아바타 폴백. */
function SupplierCell({ name, color, logoUrl }: { name: string | null; color: string | null; logoUrl: string | null }) {
  const [failed, setFailed] = useState(false)
  const label = name ?? '—'
  return (
    <span className="gpu-udetail-sup">
      {logoUrl && !failed
        ? <img className="gpu-udetail-sup-logo" src={logoUrl} alt={label} onError={() => setFailed(true)} />
        : <span className="gpu-udetail-sup-logo gpu-udetail-sup-logo--ph" style={{ background: color ?? 'var(--gpu-border)' }}>{label.charAt(0)}</span>}
      <span>{label}</span>
    </span>
  )
}

function statusLabel(status: string | null): string {
  switch (status) {
    case 'confirmed': return GPU_TERMS.statusConfirmed
    case 'pending': return GPU_TERMS.statusPending
    case 'expired': return GPU_TERMS.statusExpired
    case 'rejected': return GPU_TERMS.statusRejected
    case 'superseded': return GPU_TERMS.statusSuperseded
    default: return status ?? '—'
  }
}

// 만료 신호: 유효기간이 7일 이내면 D-N 경고, 지났으면 만료(danger). 그 외 null(배지 없음).
// 계산은 expiry.ts SSOT(결정적·테스트됨)에 위임, 라벨/색조만 매핑.
function expiryInfo(validUntil: string | null): { label: string; tone: 'warn' | 'danger' } | null {
  const s = expiryState(validUntil, Date.now())
  if (s.kind === 'expired') return { label: GPU_TERMS.statusExpired, tone: 'danger' }
  if (s.kind === 'soon') return { label: `D-${s.days}`, tone: 'warn' }
  return null
}

function formatTs(ts: string): string {
  // YYYY-MM-DD HH:mm (로컬). 파싱 실패 시 원문.
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
