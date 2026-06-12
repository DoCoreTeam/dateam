// GPU 가격관리 — 통합 표 "보기 프리셋" SSOT
//
// 통합 표(마스터·디테일)의 좌측 목록은 하나의 행 정체성(상품/구성)에 대해
// 보기(view)를 전환하면 "컬럼 프리셋만" 교체한다 — 데이터 재요청·재계산 없음(R1).
// 각 보기는 기존 탭(가격표·가격 결정·시장 비교·재고·고객가)의 비교축을 컬럼으로 표현.
//
// 라벨 규칙: 도메인 개념(공급원가·판매가·마진·시장가·공급사·모델)은 GPU_TERMS(SSOT)를 사용한다.
//   보기 이름은 기존 탭 라벨(가격표·가격 결정·시장 비교·재고수량·고객 판매가격표)과 동일하게 맞추고,
//   순수 표 헤더 보조어(자동 마진가·경쟁 최저·중앙값·표본·할인율·고객가·출처·상태)는 이 파일 로컬 라벨로 둔다.
// 컬럼 value는 통합 카탈로그 행(UnifiedRow)에서 포맷 함수로 뽑는다. 계산은 lib/gpu/* 결과를 읽기만.

import { GPU_TERMS } from './terms'

export type GpuViewId = 'sell' | 'cockpit' | 'market' | 'inventory' | 'catalog'

export type ColumnAlign = 'left' | 'right' | 'center'

export interface ViewColumn {
  /** 안정 키(컬럼 토글·저장된 보기 식별용) */
  key: string
  /** 헤더 라벨(GPU_TERMS 우선) */
  label: string
  align: ColumnAlign
  /** 숫자/통화 등 모노스페이스 정렬 권장 여부 */
  mono?: boolean
  /** 모바일에서 숨김(카드 헤더에 중복 노출되는 보조 컬럼) */
  hideMobile?: boolean
}

export interface ViewPreset {
  id: GpuViewId
  /** 보기 전환 세그먼트 라벨 */
  label: string
  /** 이 보기가 강조하는 비교축 설명(툴팁/접근성) */
  hint: string
  columns: ViewColumn[]
}

const T = GPU_TERMS

// 모델/구성 식별 컬럼 — 모든 보기 공통 선두 컬럼
const COL_MODEL: ViewColumn = { key: 'model', label: T.model, align: 'left' }

export const VIEW_PRESETS: Record<GpuViewId, ViewPreset> = {
  sell: {
    id: 'sell',
    label: '가격표',
    hint: `${T.supplyCost} 기준 ${T.sellPrice}·${T.margin}·${T.marketPrice} 대비`,
    columns: [
      COL_MODEL,
      { key: 'tier', label: 'Tier', align: 'center' },
      { key: 'sellPrice', label: T.sellPrice, align: 'right', mono: true },
      { key: 'margin', label: T.margin, align: 'right', mono: true, hideMobile: true },
      { key: 'marketDev', label: `${T.marketPrice} 대비`, align: 'right', mono: true },
      { key: 'source', label: '출처', align: 'center', hideMobile: true },
      { key: 'status', label: '상태', align: 'center' },
    ],
  },
  cockpit: {
    id: 'cockpit',
    label: '가격 결정',
    hint: `${T.supplyCost} → ${T.sellPrice} 결정(${T.margin})`,
    columns: [
      COL_MODEL,
      { key: 'supplyCost', label: T.supplyCost, align: 'right', mono: true },
      { key: 'autoPrice', label: '자동 마진가', align: 'right', mono: true, hideMobile: true },
      { key: 'sellPrice', label: T.sellPrice, align: 'right', mono: true },
      { key: 'marketMedian', label: `${T.marketPrice} 중앙`, align: 'right', mono: true, hideMobile: true },
      { key: 'margin', label: T.margin, align: 'right', mono: true },
    ],
  },
  market: {
    id: 'market',
    label: '시장 비교',
    hint: `${T.sellPrice} vs ${T.competitor} 최저/중앙/최고 편차`,
    columns: [
      COL_MODEL,
      { key: 'sellPrice', label: T.sellPrice, align: 'right', mono: true },
      { key: 'marketMin', label: '경쟁 최저', align: 'right', mono: true, hideMobile: true },
      { key: 'marketMedian', label: '중앙값', align: 'right', mono: true },
      { key: 'marketMax', label: '최고', align: 'right', mono: true, hideMobile: true },
      { key: 'marketDev', label: '편차', align: 'right', mono: true },
      { key: 'sampleCount', label: '표본', align: 'center', hideMobile: true },
    ],
  },
  inventory: {
    id: 'inventory',
    label: '재고수량',
    hint: `${T.supplier}별 가용 수량·재고 상태`,
    columns: [
      COL_MODEL,
      { key: 'supplier', label: T.supplier, align: 'left' },
      { key: 'availableQty', label: '가용 수량', align: 'right', mono: true },
      { key: 'stockStatus', label: '재고 상태', align: 'center' },
      { key: 'validUntil', label: T.statusExpired, align: 'center', mono: true, hideMobile: true },
    ],
  },
  catalog: {
    id: 'catalog',
    label: '고객 판매가격표',
    hint: `${T.sellPrice} → 파트너 등급 할인 → 고객가`,
    columns: [
      COL_MODEL,
      { key: 'sellPrice', label: T.sellPrice, align: 'right', mono: true },
      { key: 'partnerTier', label: '파트너 등급', align: 'left', hideMobile: true },
      { key: 'discountRate', label: '할인율', align: 'right', mono: true },
      { key: 'customerPrice', label: '고객가', align: 'right', mono: true },
    ],
  },
}

export const VIEW_ORDER: GpuViewId[] = ['sell', 'cockpit', 'market', 'inventory', 'catalog']

export const DEFAULT_VIEW: GpuViewId = 'sell'

export function getViewPreset(id: GpuViewId): ViewPreset {
  return VIEW_PRESETS[id]
}

/** 저장된 보기 식별자가 유효한지 검증(localStorage/URL 복원 시) */
export function isValidViewId(value: string | null | undefined): value is GpuViewId {
  return value === 'sell' || value === 'cockpit' || value === 'market' || value === 'inventory' || value === 'catalog'
}
