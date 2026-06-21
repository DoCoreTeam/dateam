'use client'

// 통합 표 — 우측 고정 상세 패널 (마스터·디테일). 인라인 드로어 금지(목록 맥락 유지).
// 탭: 공급원가(전체 견적) / 시장 비교 / 변동 이력 / 스펙.
//   - 공급원가·변동 이력은 product_id로 P5 읽기 API 연결(전체 견적·감사 필터).
//   - 시세 이력(시계열)은 mapping_id 의존 → 시장 비교 탭은 요약 + 안내(후속 P2b).
// 데이터·계산은 기존 SSOT/라우트 재사용. 본 컴포넌트는 fetch+표현만.

import { useState } from 'react'
import { X } from 'lucide-react'
import useSWR, { useSWRConfig } from 'swr'
import dynamic from 'next/dynamic'
import { fetcher } from '@/lib/swr-config'
import { mutateGpu } from '@/lib/gpu/swr-keys'
import { GPU_TERMS } from '@/lib/gpu/terms'
import { fmtMoneyFromKrw, fmtMoneyFromUsd } from '@/lib/gpu/format-price'
import { useEscClose } from '@/lib/use-esc-close'
import { resolveCancelFallback } from '@/lib/gpu/cancel-fallback'
import type { CurrencyCtx } from '@/lib/gpu/unified-row'
import { auditActionLabel } from '@/lib/gpu/audit-labels'
import { tierName } from '@/lib/gpu/unified-row'
import { formatCardMemory, perCardMemory, memoryTitle } from '@/lib/gpu/card-memory'
import type { UnifiedRow } from '@/lib/gpu/unified-row'
import type { QuoteForEdit } from '@/components/pricing/gpu/QuoteEditModal'
import type { MarketPriceForEdit } from '@/components/pricing/gpu/MarketPriceEditModal'

const QuoteEditModal = dynamic(() => import('@/components/pricing/gpu/QuoteEditModal'), { ssr: false })
const MarketPriceEditModal = dynamic(() => import('@/components/pricing/gpu/MarketPriceEditModal'), { ssr: false })
const PricingDecisionSection = dynamic(() => import('./PricingDecisionSection'), { ssr: false })

type DetailTab = 'cost' | 'pricing' | 'market' | 'history' | 'specs'

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'cost', label: GPU_TERMS.supplyCost },
  { id: 'pricing', label: '가격 결정' },
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
  price_type: string | null // 'list'(공시가)는 공급원가 견적표에서 제외
  is_selected?: boolean | null // 사용자가 판매가 기준으로 지정한 공급가(자동 최저가 override)
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
  const [costEditNote, setCostEditNote] = useState(false)
  const [designating, setDesignating] = useState<string | null>(null)
  // 공급가 지정 범위 선택 모달 대상 (지정할 견적 + 표시 라벨). null=닫힘.
  const [designateTarget, setDesignateTarget] = useState<{ qid: string; label: string } | null>(null)
  useEscClose(() => setDesignateTarget(null), !!designateTarget) // 모달 표준 §2-2(a): ESC 닫기
  // 지정 취소 확인 모달 대상. post = 취소 후 귀결(list=gcube / auto=다른 실견적 자동 / none=없음).
  const [cancelTarget, setCancelTarget] = useState<{ qid: string; supplierName: string; post: 'list' | 'auto' | 'none'; autoSupplier: string | null } | null>(null)
  useEscClose(() => setCancelTarget(null), !!cancelTarget)
  const { mutate: globalMutate } = useSWRConfig()

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

  // 가격 상세 마운트 재검증(stale 방지)은 GpuPricingClient의 nested SWRConfig(revalidateIfStale:true)가 일괄 적용.
  // (사고: 지정 변경이 타클라이언트/리로드에서 견적표 배지에 반영 안 되던 결함)
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
  // 공급원가 견적 = 실제 매입원가만(list=공시 판매가 제외).
  const costQuotes = (quoteData?.quotes ?? []).filter((q) => q.price_type !== 'list')

  // 공급가 지정/해제 — 기존 select 라우트 재사용(is_selected). 지정 시 자동 최저가를 override해 판매가 기준이 됨.
  // 성공 후 견적표 + GPU 전역 캐시(cockpit 포함) 동시 무효화 → 판매가/기준이 즉시 갱신.
  async function toggleDesignate(qid: string, next: boolean, scope: 'config' | 'model' = 'config') {
    setDesignating(qid)
    try {
      const res = await fetch(`/api/pricing/gpu/quotes/${qid}/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected: next, scope }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? '공급가 지정에 실패했습니다.')
        return
      }
      mutateQuotes()
      mutateGpu(globalMutate)
    } catch {
      alert('공급가 지정 중 오류가 발생했습니다.')
    } finally {
      setDesignating(null)
    }
  }

  // 지정 취소 요청 — 취소 후 귀결을 SSOT(resolveCancelFallback)로 판정해 확인/경고 모달을 띄운다((b)안).
  //   auto=다른 확정견적 자동 적용(공급사 명시) | list=gcube 복귀 | none=기준 없음(경고). 백엔드 cost_basis 후보와 정합.
  function requestCancel(qid: string, supplierName: string | null) {
    const hasGcube = row?.list_price_krw != null || (quoteData?.quotes ?? []).some((c) => c.price_type === 'list')
    const { post, autoSupplier } = resolveCancelFallback(quoteData?.quotes ?? [], qid, hasGcube)
    setCancelTarget({ qid, supplierName: supplierName ?? '이 공급가', post, autoSupplier })
  }

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
          <span title={memoryTitle(row.memory, row.gpu_count) || undefined}>{row.memory ? formatCardMemory(row.memory, row.gpu_count) : '—'}</span> · {GPU_TERMS.sellPrice} <strong>{mKrw(row.sell_price_krw)}</strong>
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
                  {/* 공급원가 견적표 = 실제 매입원가만. price_type='list'(우리 공시 판매가, 예: gcube)는 원가 아님 → 제외 */}
                  {costQuotes.map((q) => {
                    return (
                      <tr key={q.id} className={q.is_selected ? 'gpu-qline--selected' : undefined}>
                        <td>
                          <div className="gpu-sup-cell">
                            <SupplierCell name={q.suppliers?.name ?? null} color={q.suppliers?.color ?? null} logoUrl={q.suppliers?.logo_url ?? null} />
                            {q.is_selected && <span className="gpu-badge-selected">{GPU_TERMS.designatedCost}</span>}
                          </div>
                        </td>
                        <td className="gpu-mono">{mUsd(q.unit_price_usd)}</td>
                        <td>{q.term ?? '—'}</td>
                        <td>{statusLabel(q.status)}</td>
                        <td>
                          {q.valid_until ?? '—'}
                        </td>
                        <td className="gpu-udetail-rowacts">
                          {/* 공급가 지정 = 이 견적을 판매가 기준 공급가로 직접 지정(자동 최저가 override). 공급사·단가 있는 견적만. */}
                          {q.unit_price_usd != null && q.suppliers && (
                            <button
                              type="button"
                              className={`gpu-btn-select${q.is_selected ? ' gpu-btn-select--active' : ''}`}
                              disabled={designating === q.id}
                              onClick={() => q.is_selected
                                ? requestCancel(q.id, q.suppliers?.name ?? null)
                                : setDesignateTarget({ qid: q.id, label: q.suppliers?.name ?? '이 공급가' })}
                            >
                              {designating === q.id ? '…' : q.is_selected ? GPU_TERMS.undesignateCost : GPU_TERMS.designateCost}
                            </button>
                          )}
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
                  {/* 전파 추정: 직접 견적은 없지만 다른 구성 견적에서 전파된 공급원가 → 실견적 행과 동일 형태로 표시(원가 비롯됨) */}
                  {costQuotes.length === 0 && row.supply_cost_krw != null && (
                    <tr className={row.basis === 'selected' ? 'gpu-qline--selected' : undefined}>
                      <td>
                        <div className="gpu-sup-cell">
                          <SupplierCell name={row.cost_supplier_name} color={null} logoUrl={null} />
                          {row.basis === 'selected' && <span className="gpu-badge-selected">{GPU_TERMS.designatedCost}</span>}
                        </div>
                      </td>
                      <td className="gpu-mono">{mUsd(row.cost_unit_usd)}</td>
                      <td>{row.propagation_source_term ?? '—'}</td>
                      <td><span className="gpu-badge gpu-badge-gray">시스템 계산</span></td>
                      <td>—</td>
                      <td className="gpu-udetail-rowacts">
                        {/* 전파 모태(원본 견적)를 대상으로 지정 — '어느 구성이 진짜 견적인지' 찾을 필요 없음 */}
                        {row.propagation_source_quote_id && (
                          <button
                            type="button"
                            className={`gpu-btn-select${row.basis === 'selected' ? ' gpu-btn-select--active' : ''}`}
                            disabled={designating === row.propagation_source_quote_id}
                            onClick={() => row.basis === 'selected'
                              ? requestCancel(row.propagation_source_quote_id as string, row.cost_supplier_name)
                              : setDesignateTarget({ qid: row.propagation_source_quote_id as string, label: row.cost_supplier_name ?? '이 공급가' })}
                          >
                            {designating === row.propagation_source_quote_id ? '…' : row.basis === 'selected' ? GPU_TERMS.undesignateCost : GPU_TERMS.designateCost}
                          </button>
                        )}
                        <button type="button" className="gpu-udetail-rowbtn" onClick={() => setCostEditNote(true)}>{GPU_TERMS.edit}</button>
                      </td>
                    </tr>
                  )}
                  {costQuotes.length === 0 && row.supply_cost_krw == null && (
                    <tr><td colSpan={6} className="gpu-udetail-tbl-empty">
                      {row.sell_price_krw != null
                        ? `${GPU_TERMS.gcubeListPrice} — 직접 매입 견적 없음`
                        : GPU_TERMS.emptyList}
                    </td></tr>
                  )}
                </tbody>
              </table>
            )}
            {costEditNote && costQuotes.length === 0 && row.supply_cost_krw != null && (
              <p className="gpu-udetail-pending">
                이 단가는 {row.cost_supplier_name ?? '원'} 견적에서 전파된 시스템 계산값입니다 — 직접 수정 불가.
                원 견적(해당 모델 1장 구성)을 수정하면 모든 파생 구성에 자동 반영됩니다.
              </p>
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

        {tab === 'pricing' && <PricingDecisionSection row={row} currency={currency} />}

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
                    <td><SupplierCell name={c.company_name} color={null} logoUrl={c.logo_url} /></td>
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
            {/* 스펙 관리(SpecsTab)와 동일 데이터(buildCatalog) — 별도 구현 아님, 같은 제품 스펙 표시 */}
            <div className="gpu-udetail-kv">
              <span className="gpu-udetail-kv-k">{GPU_TERMS.model}</span>
              <span className="gpu-udetail-kv-v">{row.model_name}{row.series ? ` · ${row.series}` : ''}</span>
            </div>
            <div className="gpu-udetail-kv">
              <span className="gpu-udetail-kv-k">메모리</span>
              <span className="gpu-udetail-kv-v" title={memoryTitle(row.memory, row.gpu_count) || undefined}>{row.memory ? perCardMemory(row.memory, row.gpu_count) : '—'}</span>
            </div>
            <div className="gpu-udetail-kv">
              <span className="gpu-udetail-kv-k">GPU 수</span>
              <span className="gpu-udetail-kv-v">{row.gpu_count != null ? `${row.gpu_count}장` : '—'}</span>
            </div>
            <div className="gpu-udetail-kv">
              <span className="gpu-udetail-kv-k">vCPU</span>
              <span className="gpu-udetail-kv-v">{row.vcpu != null ? `${row.vcpu} vCPU` : '—'}</span>
            </div>
            <div className="gpu-udetail-kv">
              <span className="gpu-udetail-kv-k">RAM</span>
              <span className="gpu-udetail-kv-v">{row.ram_gb != null ? `${row.ram_gb} GB` : '—'}</span>
            </div>
            <div className="gpu-udetail-kv">
              <span className="gpu-udetail-kv-k">스토리지</span>
              <span className="gpu-udetail-kv-v">{row.storage_gb != null ? `${row.storage_gb} GB` : '—'}</span>
            </div>
            <div className="gpu-udetail-kv">
              <span className="gpu-udetail-kv-k">TIER</span>
              <span className="gpu-udetail-kv-v">{tierName(row.tier)}</span>
            </div>
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

      {designateTarget && (
        <div className="gpu-modal-backdrop" role="dialog" aria-modal="true" aria-label="공급가 지정 범위" onClick={() => setDesignateTarget(null)}>
          <div className="gpu-modal-card gpu-modal-card--sm" onClick={(e) => e.stopPropagation()}>
            <div className="gpu-modal-header">
              <strong className="gpu-modal-title">공급가 지정 범위</strong>
              <button type="button" className="gpu-modal-close" aria-label="닫기" onClick={() => setDesignateTarget(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="gpu-modal-body">
              <p className="gpu-udetail-basis">
                <strong>{designateTarget.label}</strong> 공급가를 어떻게 지정할까요? — 이 모델의 4개 구성(×1·×2·×4·×8)은 이 견적의 1장당 단가에서 전파됩니다.
              </p>
            </div>
            <div className="gpu-modal-footer">
              <button
                type="button"
                className="gpu-btn-primary gpu-udetail-rowbtn"
                onClick={() => { const t = designateTarget; setDesignateTarget(null); toggleDesignate(t.qid, true, 'model') }}
              >
                이 모델 4개 구성 전부 지정
              </button>
              <button
                type="button"
                className="gpu-udetail-rowbtn"
                onClick={() => { const t = designateTarget; setDesignateTarget(null); toggleDesignate(t.qid, true, 'config') }}
              >
                이 구성만 지정
              </button>
              <button type="button" className="gpu-udetail-rowbtn" onClick={() => setDesignateTarget(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {cancelTarget && (
        <div className="gpu-modal-backdrop" role="dialog" aria-modal="true" aria-label="지정 취소" onClick={() => setCancelTarget(null)}>
          <div className="gpu-modal-card gpu-modal-card--sm" onClick={(e) => e.stopPropagation()}>
            <div className="gpu-modal-header">
              <strong className="gpu-modal-title">{GPU_TERMS.undesignateCost}</strong>
              <button type="button" className="gpu-modal-close" aria-label="닫기" onClick={() => setCancelTarget(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="gpu-modal-body">
              <p className="gpu-udetail-basis">
                {cancelTarget.post === 'list' && <><strong>{cancelTarget.supplierName}</strong> 선택을 취소하면 gcube 공시가 기준으로 돌아갑니다.</>}
                {cancelTarget.post === 'auto' && <>선택을 취소하면 다른 실견적 <strong>{cancelTarget.autoSupplier ?? '최저가'}</strong>가 자동 적용됩니다. 무단 변경을 원치 않으면 닫고 다른 공급가를 직접 선택하세요.</>}
                {cancelTarget.post === 'none' && <><strong>지정된 공급가가 없어집니다.</strong> gcube 공시가도 없으니, 닫고 다른 공급가를 선택하세요.</>}
              </p>
            </div>
            <div className="gpu-modal-footer">
              <button
                type="button"
                className={cancelTarget.post === 'none' ? 'gpu-btn-danger gpu-udetail-rowbtn' : 'gpu-btn-primary gpu-udetail-rowbtn'}
                onClick={() => { const t = cancelTarget; setCancelTarget(null); toggleDesignate(t.qid, false) }}
              >
                {cancelTarget.post === 'list' ? 'gcube로 전환' : cancelTarget.post === 'auto' ? '자동 적용 후 취소' : '그래도 취소'}
              </button>
              <button type="button" className="gpu-udetail-rowbtn" onClick={() => setCancelTarget(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 공급원가 기준값 = buildCatalog 실효 공급원가(실견적 또는 per-GPU 전파). 공시가(list)는 원가가 아니므로 폴백 금지.
 *  판매가가 있는데 cost가 없으면(공시가 기반 구성) 공시가=판매가 자체를 기준으로 표시. */
function costBasisKrw(row: UnifiedRow): number | null {
  if (row.supply_cost_krw != null) return row.supply_cost_krw
  if (row.sell_price_krw != null) return row.list_price_krw ?? row.sell_price_krw
  return null
}

/** 공급원가 출처 라벨: 추종가/전파 추정/공시가/실견적. is_propagated면 전파 우선. */
export function basisSourceLabel(row: UnifiedRow): string {
  // 지정 공급가(사용자가 명시 채택)는 추종가/전파보다 최우선.
  if (row.basis === 'selected') return GPU_TERMS.designatedCost
  if (row.cost_source === 'market_link') return GPU_TERMS.followPrice
  if (row.is_propagated) return '전파 추정'
  switch (row.basis) {
    case 'propagated': return '전파 추정'
    case 'list': return GPU_TERMS.gcubeListPrice
    case 'none': return row.sell_price_krw != null && row.supply_cost_krw == null ? GPU_TERMS.gcubeListPrice : GPU_TERMS.realQuote
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
      <span className="gpu-udetail-sup-name">{label}</span>
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

function formatTs(ts: string): string {
  // YYYY-MM-DD HH:mm (로컬). 파싱 실패 시 원문.
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
