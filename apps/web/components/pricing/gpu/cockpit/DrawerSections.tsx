'use client'

// components/pricing/gpu/cockpit/DrawerSections.tsx
// 셀 클릭 즉시 펼침 드로어 섹션 4종:
//   - CostDrawer: 원가 공급사별 상세
//   - CompetitorDrawer: 경쟁사별 가격 비교
//   - GcubeDrawer: gcube 사이트 가격 출처/갱신일 + gcube 반영 상태 비교
//   - StrategicHistoryDrawer: 우리 판매가 변경이력

import { fmtKRW } from '@/lib/gpu/format-price'
import type { CockpitProduct } from './types'
import type { GcubeCheckItem } from '@/app/api/pricing/gpu/gcube-check/route'
import { GcubeSyncBadge } from './GcubeSyncBadge'

// ── 공통: 탭 이동 콜백 prop ──────────────────────────────────────

interface NavProps {
  onGoToTab: (tab: string) => void
  productId?: string
  modelName?: string
}

// ── 원가 드로어 ──────────────────────────────────────────────────

interface CostDrawerProps extends NavProps {
  product: CockpitProduct
}

export function CostDrawer({ product, onGoToTab }: CostDrawerProps) {
  const { cost_min_krw, cost_max_krw, cost_suppliers } = product
  const hasCostData = cost_suppliers && cost_suppliers.length > 0
  // 행 수준 전파 여부 — cost_is_propagated(신규 BE 필드) 우선, 없으면 is_propagated 폴백
  const isPropagated = product.cost_is_propagated ?? (product.is_propagated && !hasCostData) ?? false

  return (
    <div className="cockpit-section-drawer">
      <div className="cockpit-drawer-header">
        <strong className="cockpit-drawer-title">원가 상세</strong>
        <span className="cockpit-drawer-desc">
          공급사별 매입 단가 — 실제 비용 기준 범위
          {isPropagated && (
            <span className="cockpit-basis-tag">추정</span>
          )}
        </span>
      </div>

      {isPropagated && (
        <p className="cockpit-propagated-note">
          이 구성에 직접 등록된 견적이 없습니다. 동일 모델의 1장당 최저 단가를 구성 수로 환산한 <strong>추정 원가</strong>입니다.
        </p>
      )}

      {!hasCostData && (cost_min_krw == null) && (
        <p className="cockpit-drawer-empty">원가 데이터가 없습니다</p>
      )}

      {(cost_min_krw != null || cost_max_krw != null) && (
        <div className="cockpit-drawer-range-row">
          <span className="cockpit-drawer-range-label">{isPropagated ? '추정 범위' : '범위'}</span>
          <span className="cockpit-price">
            {fmtKRW(cost_min_krw)}
            {cost_max_krw != null && cost_max_krw !== cost_min_krw && (
              <> ~ {fmtKRW(cost_max_krw)}</>
            )}
          </span>
        </div>
      )}

      {hasCostData && (
        <ul className="cockpit-supplier-list">
          {cost_suppliers.map((s, i) => (
            <li
              key={i}
              className={`cockpit-supplier-item${s.is_propagated ? ' cockpit-supplier-item--propagated' : ''}`}
            >
              <span className="cockpit-supplier-name">{s.supplier_name}</span>
              <span className="cockpit-price">{fmtKRW(s.unit_price_krw)}</span>
              {s.gpu_count > 1 && (
                <span className="cockpit-price-sub">×{s.gpu_count}GPU</span>
              )}
              {s.is_propagated ? (
                <span
                  className="cockpit-propagated-tag"
                  title="실제 견적 없음 — 상위 구성 1GPU 단가×수량 추정"
                >
                  전파 추정
                </span>
              ) : s.basis ? (
                <span className="cockpit-basis-tag">{s.basis}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="cockpit-drawer-nav-row">
        <button
          className="cockpit-nav-btn"
          onClick={() => onGoToTab('board')}
          aria-label="가격표 탭에서 공급 견적 보기"
        >
          공급사·견적 보기
        </button>
        <button
          className="cockpit-nav-btn"
          onClick={() => onGoToTab('suppliers')}
          aria-label="공급사 탭으로 이동"
        >
          공급사 탭으로
        </button>
      </div>
    </div>
  )
}

// ── 경쟁사 드로어 ─────────────────────────────────────────────────

interface CompetitorDrawerProps extends NavProps {
  product: CockpitProduct
  activeCompetitor: string | null
  onSelectCompetitor: (name: string) => void
}

export function CompetitorDrawer({
  product,
  onGoToTab,
  activeCompetitor,
  onSelectCompetitor,
}: CompetitorDrawerProps) {
  const { competitor_min_krw, competitor_max_krw, competitors } = product
  const hasData = competitors && competitors.length > 0

  return (
    <div className="cockpit-section-drawer">
      <div className="cockpit-drawer-header">
        <strong className="cockpit-drawer-title">경쟁사 가격</strong>
        <span className="cockpit-drawer-desc">
          시장에서 동일 모델을 판매 중인 회사별 가격
        </span>
      </div>

      {!hasData && competitor_min_krw == null && (
        <p className="cockpit-drawer-empty">경쟁사 데이터가 없습니다</p>
      )}

      {(competitor_min_krw != null || competitor_max_krw != null) && (
        <div className="cockpit-drawer-range-row">
          <span className="cockpit-drawer-range-label">시장 범위</span>
          <span className="cockpit-price">
            {fmtKRW(competitor_min_krw)}
            {competitor_max_krw != null && competitor_max_krw !== competitor_min_krw && (
              <> ~ {fmtKRW(competitor_max_krw)}</>
            )}
          </span>
        </div>
      )}

      {hasData && (
        <ul className="cockpit-competitor-list">
          {competitors.map((c, i) => {
            const isActive = activeCompetitor === c.company_name
            return (
              <li
                key={i}
                className={`cockpit-competitor-item${isActive ? ' cockpit-competitor-item--active' : ''}`}
              >
                <button
                  className="cockpit-competitor-btn"
                  onClick={() => onSelectCompetitor(isActive ? '' : c.company_name)}
                  aria-pressed={isActive}
                >
                  <span className="cockpit-competitor-name">{c.company_name}</span>
                  <span className="cockpit-price">{fmtKRW(c.price_krw)}</span>
                  <span className="cockpit-price-sub">
                    {new Date(c.recorded_at).toLocaleDateString('ko-KR', {
                      month: '2-digit',
                      day: '2-digit',
                    })} 기준
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="cockpit-drawer-nav-row">
        <button
          className="cockpit-nav-btn"
          onClick={() => onGoToTab('market')}
          aria-label="시장 비교 탭으로 이동"
        >
          시장 비교에서 보기
        </button>
      </div>
    </div>
  )
}

// ── gcube 사이트 가격 드로어 ──────────────────────────────────────

interface GcubeDrawerProps extends NavProps {
  product: CockpitProduct
  /** gcube-check API에서 병합된 반영 상태 아이템 */
  syncItem?: GcubeCheckItem
}

export function GcubeDrawer({ product, onGoToTab, syncItem }: GcubeDrawerProps) {
  const { gcube_site_price_krw, gcube_site_updated_at } = product
  const hasMismatch = syncItem?.status === 'mismatch'

  return (
    <div className="cockpit-section-drawer">
      <div className="cockpit-drawer-header">
        <strong className="cockpit-drawer-title">gcube 사이트 게시 가격</strong>
        <span className="cockpit-drawer-desc">
          gcube.co.kr에 현재 표시 중인 판매 가격
        </span>
        <GcubeSyncBadge item={syncItem} showDetail />
      </div>

      {gcube_site_price_krw == null ? (
        <p className="cockpit-drawer-empty">사이트 게시 가격이 등록되지 않았습니다</p>
      ) : (
        <div className="cockpit-drawer-range-row">
          <span className="cockpit-drawer-range-label">사이트 가격</span>
          <span className="cockpit-price cockpit-price--gcube">{fmtKRW(gcube_site_price_krw)}</span>
        </div>
      )}

      {/* gcube.ai 반영 비교 — 데이터 있는 경우만 */}
      {syncItem && (syncItem.gcube_low_krw != null || syncItem.gcube_high_krw != null) && (
        <div className="cockpit-gcube-sync-compare">
          <div className="cockpit-drawer-range-row">
            <span className="cockpit-drawer-range-label">gcube 범위</span>
            <span className="cockpit-price">
              {syncItem.gcube_low_krw != null ? fmtKRW(syncItem.gcube_low_krw) : '—'}
              {syncItem.gcube_high_krw != null && syncItem.gcube_high_krw !== syncItem.gcube_low_krw && (
                <> ~ {fmtKRW(syncItem.gcube_high_krw)}</>
              )}
            </span>
          </div>
          {syncItem.our_price_krw != null && (
            <div className="cockpit-drawer-range-row">
              <span className="cockpit-drawer-range-label">우리 판매가</span>
              <span className="cockpit-price">{fmtKRW(syncItem.our_price_krw)}</span>
            </div>
          )}
          {hasMismatch && (
            <p className="cockpit-gcube-sync-notice">
              우리 판매가가 gcube 범위와 맞지 않습니다 — 가격표에서 반영을 확인하세요.
            </p>
          )}
          {syncItem.checked_at && (
            <div className="cockpit-drawer-meta">
              마지막 확인:{' '}
              {new Date(syncItem.checked_at).toLocaleString('ko-KR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          )}
        </div>
      )}

      {gcube_site_updated_at && (
        <div className="cockpit-drawer-meta">
          마지막 업데이트:{' '}
          {new Date(gcube_site_updated_at).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          })}
        </div>
      )}

      <div className="cockpit-drawer-nav-row">
        <button
          className="cockpit-nav-btn"
          onClick={() => onGoToTab('board')}
          aria-label="가격표 탭에서 보기"
        >
          가격표에서 보기
        </button>
      </div>
    </div>
  )
}

// ── 우리 판매가 이력 드로어 ───────────────────────────────────────

interface StrategicHistoryDrawerProps {
  product: CockpitProduct
}

export function StrategicHistoryDrawer({ product }: StrategicHistoryDrawerProps) {
  const { strategic_history } = product

  return (
    <div className="cockpit-section-drawer">
      <div className="cockpit-drawer-header">
        <strong className="cockpit-drawer-title">우리 판매가 변경 이력</strong>
        <span className="cockpit-drawer-desc">
          포지셔닝 가격 설정 내역 (최근 5건)
        </span>
      </div>

      {strategic_history.length === 0 ? (
        <p className="cockpit-drawer-empty">변경 이력이 없습니다</p>
      ) : (
        <ul className="cockpit-history-list">
          {strategic_history.map((h, i) => (
            <li key={i} className="cockpit-history-item">
              <span className="cockpit-history-ts">
                {new Date(h.ts).toLocaleDateString('ko-KR', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="cockpit-history-actor">{h.actor}</span>
              <span className="cockpit-history-change">
                {h.before != null ? fmtKRW(h.before) : '미설정'}{' '}
                &rarr;{' '}
                {h.after != null ? fmtKRW(h.after) : '해제'}
              </span>
              {h.reason && (
                <span className="cockpit-history-reason">{h.reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
