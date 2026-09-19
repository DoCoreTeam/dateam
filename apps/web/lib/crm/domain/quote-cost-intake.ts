/**
 * 받은 견적서의 줄을 **딜 원가 항목**으로 옮기는 매핑 (순수)
 *
 * ## 왜 화면이 아니라 여기 있나
 *
 * 이 매핑은 숫자를 옮기는 일이라 **틀려도 화면에는 안 보인다** — 원가는 관리자만 보고,
 * 그 화면을 매일 여는 사람은 없다. 화면 안에 두면 검사할 방법이 스크린샷뿐이다.
 * 여기 두면 `node --test` 가 줄마다 본다(화면 파일은 `@/` 별칭과 tsx 라 테스트가 못 읽는다).
 *
 * ## 여기서 하지 않는 것
 *
 * **고르지 않는다.** 갈래도 시점도 부르는 쪽이 정해서 넘긴다 — 문서를 봐서는 알 수 없는 것이라
 * 여기서 추측하면 사람이 되돌리는 일부터 하게 된다(사용자 지시 2026-09-19: "사용자에게 자율성을 줘").
 * **계산하지 않는다.** 줄 금액은 `quote-reconcile` 이 이미 냈다. 여기서 또 계산하면 두 값이 갈린다.
 */

import {
  COST_CATEGORY_ORDER, COST_STAGE_ORDER,
  type CostCategory, type CostStage,
} from '../../terms/cost.ts'

/** 원가로 옮길 줄 하나 — 사람이 검수를 마친 뒤의 값 */
export interface IntakeLine {
  name: string
  /** 규격·설명 */
  descriptionMd?: string | null
  /** 그 줄의 금액(부가세 전). minor 단위 문자열 */
  amountMinor: string
  /** 문서에서 이 줄이 있던 자리의 원문 조각 */
  sourceText?: string | null
  /** 같은 건으로 방금 만든 판매 견적의 그 줄. 없으면 null */
  quoteLineId?: string | null
}

export interface IntakeOptions {
  category: CostCategory
  stage: CostStage
  /** 어느 파일에서 왔나 — 근거에 적는다 */
  fileName?: string | null
}

/** 창구(`POST /api/crm/deals/:id/costs`)가 받는 모양 */
export interface CostPayload {
  name: string
  category: CostCategory
  stage: CostStage
  inputMode: 'AMOUNT'
  amountMinor: string
  descriptionMd: string | null
  basisNote: string | null
  quoteLineId: string | null
}

/**
 * 갈래 기본값 — **재료비**.
 *
 * 받은 견적서는 대개 매입 명세다(「GPU 매입 · 서버·스위치 소싱 · 라이선스 매입」 —
 * `COST_CATEGORY_HINT.MATERIAL`). 다만 이것은 **고르는 칸의 처음 값일 뿐**이고,
 * 원가로 보내기로 한 사람이 그 자리에서 바꾼다.
 */
export const INTAKE_DEFAULT_CATEGORY: CostCategory = 'MATERIAL'

/**
 * 시점 기본값 — **추정**.
 *
 * 견적서를 받은 시점에 확정된 것은 아무것도 없다. 확정(COMMITTED)으로 들어가면
 * 「얼마나 틀렸나」를 나중에 볼 수 없다 — 추정과 실적을 견줄 짝이 사라지기 때문이다.
 */
export const INTAKE_DEFAULT_STAGE: CostStage = 'ESTIMATE'

/** 근거에 싣는 원문 조각의 길이 상한 — 표 한 줄이 통째로 들어오면 근거 칸이 벽이 된다 */
const SOURCE_MAX = 120

function clip(text: string): string {
  return text.length <= SOURCE_MAX ? text : `${text.slice(0, SOURCE_MAX)}…`
}

/**
 * 근거 한 줄 — **어느 파일의 어느 줄에서 나온 숫자인가**.
 *
 * 원가를 넣고 나면 반드시 「이 숫자 어디서 왔지」를 찾게 된다. 파일 이름만 적으면
 * 그 파일 안 어디였는지를 다시 뒤져야 하므로 원문 조각을 함께 남긴다.
 */
export function costBasisNote(
  fileName: string | null | undefined,
  sourceText: string | null | undefined,
): string | null {
  const file = (fileName ?? '').trim()
  const src = (sourceText ?? '').trim()
  if (!file && !src) return null
  if (!src) return file
  return file ? `${file}: ${clip(src)}` : clip(src)
}

/**
 * 원가 줄을 방금 만든 판매 견적의 줄과 **짝짓는다**.
 *
 * **개수가 다르면 아무것도 잇지 않는다.** 순서로 짝짓는 방식이라 하나라도 어긋나면
 * 그 뒤가 전부 밀려 **남의 줄에 원가가 붙는다** — 그렇게 붙은 원가는 화면에서
 * 「이 항목의 원가」로 보이므로 틀린 줄 마진이 그럴듯하게 계산된다. 못 잇는 것이 낫다.
 */
export function withQuoteLineIds(
  lines: readonly IntakeLine[],
  quoteLineIds: readonly (string | null | undefined)[],
): IntakeLine[] {
  if (quoteLineIds.length !== lines.length) return lines.map((l) => ({ ...l, quoteLineId: null }))
  return lines.map((l, i) => ({ ...l, quoteLineId: quoteLineIds[i] ?? null }))
}

function normalizeCategory(v: CostCategory): CostCategory {
  return COST_CATEGORY_ORDER.includes(v) ? v : INTAKE_DEFAULT_CATEGORY
}

function normalizeStage(v: CostStage): CostStage {
  return COST_STAGE_ORDER.includes(v) ? v : INTAKE_DEFAULT_STAGE
}

/**
 * 검수한 줄을 원가 항목 모양으로.
 *
 * **이름이 빈 줄은 뺀다.** 서버가 거절하는 값이라 함께 보내면 한 줄 때문에 그 건 전체가 실패한다.
 * **넣는 방식은 금액으로(AMOUNT) 고정이다** — 문서에 적힌 것은 결과 금액이고,
 * 공수나 비율로 되돌리는 것은 우리가 지어내는 일이다.
 */
export function toCostPayloads(
  lines: readonly IntakeLine[],
  options: IntakeOptions,
): CostPayload[] {
  const category = normalizeCategory(options.category)
  const stage = normalizeStage(options.stage)
  return lines
    .filter((l) => (l.name ?? '').trim())
    .map((l) => ({
      name: l.name.trim(),
      category,
      stage,
      inputMode: 'AMOUNT' as const,
      amountMinor: (l.amountMinor ?? '').trim() || '0',
      descriptionMd: (l.descriptionMd ?? '').trim() || null,
      basisNote: costBasisNote(options.fileName, l.sourceText),
      quoteLineId: l.quoteLineId ?? null,
    }))
}
