/**
 * 쪼개는 기준 선언 — SSOT
 *
 * **이 파일에 «공공»·«B2B»·«대학» 같은 값이 하나도 없다.** 그게 이 파일의 요점이다.
 * 축은 «값이 어디서 오는지»(경로)만 알고, **목록은 데이터에서 자란다.**
 * 새 파이프라인을 만들면 축 값이 하나 늘고, 회사 보강이 산업을 채우면 그 산업이 값이 된다 —
 * **배포 없이 늘어난다.**
 *
 * 값을 코드에 적으면 어떻게 되는지는 이미 겪었다. 사업 유형이 enum 여덟이라
 * 「유지보수」 사업을 「기타」로 적을 수밖에 없었고, 그러면 「어떤 사업이 남는 장사였나」에
 * 영원히 답할 수 없다(마이그 242 가 그것을 표로 내렸다).
 *
 * **순수하다** — DB 를 모른다. 실제 값을 읽는 것은 집계 엔진의 일이다.
 */

import { COMPANY_KIND_LABEL } from './company-kind.ts'
import { DIMENSION_EMPTY } from '../../terms/report.ts'

/**
 * 값이 오는 경로.
 *
 * 늘리려면 **딜에서 그 값까지 실제로 이어져 있어야** 한다.
 * 안 이어진 경로를 적으면 그 축은 언제나 「없음」 한 줄이다.
 */
export type DimensionSource =
  | 'deal.stage'
  | 'deal.pipeline'
  | 'deal.businessType'
  | 'deal.owner'
  | 'company'
  | 'company.industry'
  | 'company.region'
  | 'company.employeeRange'
  | 'company.kind'

export interface DimensionDecl {
  key: string
  label: string
  source: DimensionSource
  /**
   * 저장된 값이 id 라서 이름을 따로 읽어야 하나.
   *
   * 이름을 안 읽으면 축에 `cmsw4k1qv…` 가 찍힌다 — 실제로 예전 리포트가
   * 사업 유형 키를 그대로 찍어 축에 「SOLUTION」이 영문으로 떴다.
   */
  needsLookup: boolean
  /** 값이 비어 있는 줄의 이름. 숨기면 합이 안 맞는다 */
  emptyLabel: string
  /** 왜 이 기준으로 보나 — 고를 때 읽는 한 줄 */
  hint: string
}

export const DIMENSIONS: readonly DimensionDecl[] = [
  {
    key: 'stage', label: '단계', source: 'deal.stage', needsLookup: true,
    emptyLabel: `단계 ${DIMENSION_EMPTY}`,
    hint: '어느 단계에 걸려 있나. 전환 깔때기의 축입니다',
  },
  {
    key: 'pipeline', label: '파이프라인', source: 'deal.pipeline', needsLookup: true,
    emptyLabel: `파이프라인 ${DIMENSION_EMPTY}`,
    hint: '어느 영업 흐름을 타나. 흐름이 다르면 사는 방식도 다릅니다',
  },
  {
    key: 'businessType', label: '사업 유형', source: 'deal.businessType', needsLookup: true,
    emptyLabel: `유형 ${DIMENSION_EMPTY}`,
    hint: '무엇을 파는 일인가. 목록은 설정에서 늘립니다',
  },
  {
    key: 'owner', label: '담당자', source: 'deal.owner', needsLookup: true,
    emptyLabel: `담당자 ${DIMENSION_EMPTY}`,
    hint: '누가 맡고 있나',
  },
  {
    key: 'company', label: '회사', source: 'company', needsLookup: true,
    emptyLabel: `회사 ${DIMENSION_EMPTY}`,
    hint: '어느 고객인가. 집중도가 여기서 나옵니다',
  },
  {
    key: 'companyKind', label: '기관 종류', source: 'company.kind', needsLookup: false,
    emptyLabel: `종류 ${DIMENSION_EMPTY}`,
    hint: '학교인가 정부인가 기업인가. 도메인으로 자동 판정됩니다',
  },
  {
    key: 'industry', label: '산업', source: 'company.industry', needsLookup: false,
    emptyLabel: `산업 ${DIMENSION_EMPTY}`,
    hint: '무엇을 하는 회사인가. 회사 정보 채우기로 채워집니다',
  },
  {
    key: 'region', label: '지역', source: 'company.region', needsLookup: false,
    emptyLabel: `지역 ${DIMENSION_EMPTY}`,
    hint: '어디에 있나',
  },
  {
    key: 'employeeRange', label: '규모', source: 'company.employeeRange', needsLookup: false,
    emptyLabel: `규모 ${DIMENSION_EMPTY}`,
    hint: '직원 수 구간. 구간은 이미 고정돼 있어 축으로 바로 쓸 수 있습니다',
  },
]

const BY_KEY: ReadonlyMap<string, DimensionDecl> = new Map(DIMENSIONS.map((d) => [d.key, d]))

export function dimensionOf(key: string): DimensionDecl | null {
  return BY_KEY.get(key) ?? null
}

/**
 * 우리가 아는 기준인가 — **AI 도우미가 이 함수로 걸린다.**
 *
 * 모델이 「고객군별로」 같은 없는 축을 만들어 오면 여기서 막고 되묻는다.
 */
export function isKnownDimension(key: string): boolean {
  return BY_KEY.has(key)
}

export function dimensionCatalog(): { key: string; label: string; hint: string }[] {
  return DIMENSIONS.map((d) => ({ key: d.key, label: d.label, hint: d.hint }))
}

/**
 * 리포트 축에서 숨길 파이프라인인가.
 *
 * 검증용으로 만든 파이프라인이 운영에 남아 있다(딜 0건). 지우는 것은 이 작업의
 * 범위 밖이라 **축에서만 숨긴다** — 규칙은 이름 하나다.
 * 딜이 붙어 있으면 숨기지 않는다. 숨기면 합이 조용히 줄어든다.
 */
export function isHiddenPipelineName(name: string): boolean {
  return name.startsWith('__')
}

/** 기관 종류 값의 이름 — 축이 그리는 라벨 */
export function companyKindLabel(kind: string | null): string | null {
  if (!kind) return null
  return (COMPANY_KIND_LABEL as Record<string, string>)[kind] ?? null
}

/**
 * 이 기준이 「지금 쓸 만한가」.
 *
 * 채워진 비율이 낮으면 축을 그려도 「없음」 한 줄이 된다. 그래도 **그리기는 한다** —
 * 숨기면 왜 안 보이는지 알 수 없고, 채울 이유도 안 생긴다.
 * 대신 화면이 **채움 비율을 먼저 말한다**(`dimensionThin`).
 */
export const DIMENSION_THIN_RATIO = 0.3

export function isThin(filled: number, total: number): boolean {
  if (total <= 0) return false
  return filled / total < DIMENSION_THIN_RATIO
}
