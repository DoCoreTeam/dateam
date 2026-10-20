/**
 * 가격 기준의 말 — 제품, 품목, 규칙, 조건, 출처
 *
 * DB 도 AI 도 모르는 모양이다. 서비스가 DB 줄을 이 모양으로 바꿔 엔진에 넘기고,
 * 엔진은 이 모양만 보고 항목을 낸다. 그래서 정답 견적을 DB 없이 시험할 수 있다.
 */

import type { CompanyKind } from '../company-kind.ts'
import type { Billing } from '../quote-compose.ts'

/** 품목 하나의 가격 기준 — 1식, 단위당, 비율, 실사 후 견적 */
export type ItemBasis = 'FIXED' | 'PER_UNIT' | 'RATIO' | 'SURVEY'
export const ITEM_BASES: readonly ItemBasis[] = ['FIXED', 'PER_UNIT', 'RATIO', 'SURVEY']

/** 견적 한 칸이 받는 가격 기준 넷과 직접 입력 */
export type PriceSource = 'LIST' | 'LABOR' | 'GPU' | 'COST_MARGIN' | 'MANUAL'

export interface PriceItem {
  id: string
  name: string
  /** 묶음 이름 — 라이선스, 구축비, 유지보수 */
  section: string
  /** 정상가(원). null 이면 실사 후 견적이거나 비율이다 */
  listPriceMinor: bigint | null
  basis: ItemBasis
  unit: string | null
  billing: Billing
  /** 비율 품목이면 몇 % 인가, 대상 묶음은 무엇인가 */
  ratioPct?: number | null
  ratioOfSection?: string | null
  /** 할인 규칙이 걸리는가. 구축비와 크레딧은 아니다 */
  discountable: boolean
  taxRate: number
  remark?: string | null
  /** 파일로 읽어 검증에 걸린 가격 — 자동 채움의 기준으로 쓰지 않는다 */
  needsReview?: boolean
}

/** 조건에서 나오는 수 — 닫힌 목록이다. 무엇이든 적는 수식 칸은 검증할 수 없다 */
export type VarKey = 'gpu.dc' | 'gpu.ws' | 'gpu.timed' | 'gpu.total' | 'nodes' | 'training'
export const VAR_KEYS: readonly VarKey[] = ['gpu.dc', 'gpu.ws', 'gpu.timed', 'gpu.total', 'nodes', 'training']

/** GPU 라이선스 구분 — 데이터센터, 워크스테이션, 소비자, NPU */
export type GpuClass = 'DC' | 'WS' | 'CONSUMER' | 'NPU'

/**
 * 규칙 일곱 종류. 늘리지 않는다 — 여덟 번째가 필요하면 코드로 하나 더한다.
 *
 *   ONE_OF    하나만 고름          STD 와 ENT 중 하나
 *   WITH      같이 들어감          STD 를 고르면 STD 기본 구축
 *   INCLUDES  기본 포함            ENT 는 옵션 셋이 0원 / STD 구축은 노드 20대 포함
 *   QTY_FROM  수량 따라감          GPU 라이선스 수량은 데이터센터 GPU 장수
 *   CAP       상한                 STD 는 GPU 합계 300장까지
 *   ELIGIBLE  고를 수 있는 조건    지정 시간은 워크스테이션과 데스크톱 GPU 만
 *   DISCOUNT  할인                 기관 종류가 학교면 할인 대상 품목에 10%
 *   SCALE_CAP 규모 조정            라이선스 정가 소계가 GPU 수 × 728.3만원을 넘으면 넘는 만큼 할인
 *   UPGRADE   전환                 STD 를 산 고객이 ENT 를 고르면 ENT 전환 구축
 *
 * 여덟째(SCALE_CAP)는 실제 가격표 v0.7.0 의 「규모 조정 할인」 때문에 코드로 더했다(P0135 I12).
 * 아홉째(UPGRADE)는 「ENT 전환 구축」이 고객의 지난 계약을 알아야 해서 더했다(P0137). 이미 산 품목은 조건의 owned 로 온다.
 */
export type PriceRule =
  | { kind: 'ONE_OF'; items: string[] }
  | { kind: 'WITH'; item: string; with: string[] }
  | { kind: 'INCLUDES'; item: string; items?: string[]; varKey?: VarKey; qty?: number }
  | { kind: 'QTY_FROM'; item: string; varKey: VarKey; minusIncluded?: boolean }
  | { kind: 'CAP'; item: string; varKey: VarKey; max: number }
  | { kind: 'ELIGIBLE'; item: string; classes: GpuClass[] }
  | { kind: 'DISCOUNT'; companyKind: CompanyKind | 'partner'; pct: number; confirmed: boolean; label: string }
  | { kind: 'SCALE_CAP'; section: string; varKey: VarKey; perUnitMinor: number }
  | { kind: 'UPGRADE'; item: string; from: string; to: string }

export type RuleKind = PriceRule['kind']
export const RULE_KINDS: readonly RuleKind[] = ['ONE_OF', 'WITH', 'INCLUDES', 'QTY_FROM', 'CAP', 'ELIGIBLE', 'DISCOUNT', 'SCALE_CAP', 'UPGRADE']

export interface ProductSection {
  name: string
  /** 묶음 절사 단위(원). 가격표의 「만원 미만 절사」면 10000 */
  roundingUnit: number
}

/** 가격표의 계산 예시 — 미리 계산이 이 금액을 내야 한다 */
export interface PriceExample {
  label: string
  conditions: SolutionConditions
  /** 기대 금액(원) — 초기 도입 금액, 연 유지보수, 몇 년 총비용 */
  expectOnceMinor: bigint
  expectAnnualMinor: bigint
  expectTcoMinor?: bigint | null
}

export interface PriceProduct {
  id: string
  name: string
  businessTypeKey: string
  sections: ProductSection[]
  items: PriceItem[]
  rules: PriceRule[]
  /** 몇 년 총비용과 무상 년수. 가격표: 5년, 첫해 무상 */
  tcoYears: number
  freeYears: number
  examples?: PriceExample[]
}

export interface GpuPick {
  model: string
  count: number
  /** 지정 시간 제공이면 true, 상시면 false */
  timed: boolean
  /** 사람이 구분을 고쳤으면 그 값 */
  classOverride?: GpuClass | null
}

/** 솔루션 견적 조건 — 말하지 않은 칸은 null 이고 엔진이 채운다 */
export interface SolutionConditions {
  /** 사람이 고른 품목(에디션, 옵션, 유지보수, 추가 교육 등) */
  picked: string[]
  gpus: GpuPick[]
  nodes: number | null
  training: number | null
  companyKind: CompanyKind | null
  /** 할인: auto 면 기관 종류 규칙, none 이면 없음, 숫자면 말한 할인율 */
  discount: 'auto' | 'none' | number
  /** 이 고객이 지난 계약에서 이미 산 품목 — 전환 규칙이 본다. 비면 「모름」이 아니라 「산 것 없음」 */
  owned?: string[]
  /** 이미 산 품목의 근거 한 줄 — 「2025-03-14 체결 계약 숙명여대 gcube 도입」 */
  ownedNote?: string | null
}

/**
 * 출처 — 채운 칸마다 붙는다. 견적서에는 싣지 않는다.
 * 순서는 `FILL_PRECEDENCE` 가 정한다.
 */
export type ProvenanceSource =
  | 'HUMAN'        // 사람이 고침
  | 'SAID'         // 말한 값 (말, 문서, 파일)
  | 'BUDGET'       // 예산 맞추기
  | 'RULE'         // 품목 규칙
  | 'PRICEBOOK'    // 가격 기준(정상가, 등급 단가)
  | 'GPU_PRICE'    // GPU 판매가
  | 'COST_MARGIN'  // 원가와 마진율
  | 'LAST_QUOTE'   // 지난 견적
  | 'PUBLIC_LABOR' // 공표 노임단가
  | 'COMPANY_KIND' // 기관 종류
  | 'DEAL_BUDGET'  // 딜 예산
  | 'DEFAULT'      // 기본값
  | 'UNVERIFIED'   // 확인 전 가격
  | 'AI_REVIEW'    // AI 검토가 고침 (사람이 「AI로 한 번 더 보기」를 눌렀을 때)

export interface Provenance {
  source: ProvenanceSource
  /** 사람이 읽을 한 줄 — 「기본 구축 포함 대수로 채움」 */
  note?: string | null
}

export type ViolationLevel = 'block' | 'warn'

export interface Violation {
  level: ViolationLevel
  code:
    | 'ONE_OF' | 'CAP' | 'ELIGIBLE' | 'SURVEY' | 'NO_PRICE' | 'UNKNOWN_ITEM'
    | 'UNVERIFIED' | 'NO_EDITION' | 'LOCKED_DIFFERS' | 'UPGRADE_NOT_OWNED'
  itemId?: string | null
  message: string
}
