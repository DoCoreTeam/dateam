/**
 * 계약 모듈 — 종류와 켜는 조건 (P0184 I06)
 *
 * **조건은 데이터다.** 「매출이고 GPU 임대면 크레딧 조항을 켠다」 같은 규칙을 코드에 if 로 적으면
 * 규칙이 바뀔 때마다 배포가 필요하고, 관리자 화면이 그 규칙을 보여 줄 길이 없다.
 * 그래서 조건을 JSON 으로 받아 여기서 검사하고 판정한다. 화면과 서버가 같은 판정기를 쓴다.
 *
 * **모르는 칸은 거절한다.** 칸 이름을 아무 글자나 받으면 오타 난 조건이 영영 안 켜지고
 * 그 사실이 어디에도 안 보인다. 방향, 사업 유형, 계약 칸 값 셋만 받는다.
 */

import { CONTRACT_MODULE_MSG } from '../../terms/contract-doc.ts'

/** 고르는 모듈 종류 넷. 공통(COMMON)은 고르는 것이 아니라 조립의 바탕이다 */
export const MODULE_KINDS = ['PERFORMANCE', 'CONSIDERATION', 'REGULATION', 'ANNEX'] as const
export type ModuleKind = (typeof MODULE_KINDS)[number]
export type ModuleKindOrCommon = ModuleKind | 'COMMON'
export const ALL_MODULE_KINDS: readonly ModuleKindOrCommon[] = ['COMMON', ...MODULE_KINDS]

export const MAX_CONDITION_RULES = 20

export type ConditionOp = 'in' | 'notIn' | 'truthy'

export interface ConditionRule {
  /** direction | businessTypeKey | value.<칸 키> */
  field: string
  op: ConditionOp
  values?: string[]
}

/** 모든 줄이 맞아야 켜진다 */
export interface ModuleCondition {
  all: ConditionRule[]
}

export interface ContractModule {
  key: string
  kind: ModuleKindOrCommon
  title: string
  clauseKeys: string[]
  enableWhen: ModuleCondition | null
  position: number
}

/** 조건을 판정할 때 보는 계약의 사실 */
export interface ModuleContext {
  direction: string
  businessTypeKey: string | null
  /** 계약 칸 값 (contract.amount 같은 키) */
  values: Readonly<Record<string, string>>
}

export class ModuleInputError extends Error {}

const FIELD_PATTERN = /^(direction|businessTypeKey|value\.[a-zA-Z][\w.]{0,63})$/
const OPS: readonly ConditionOp[] = ['in', 'notIn', 'truthy']

export function isModuleKind(v: unknown): v is ModuleKindOrCommon {
  return ALL_MODULE_KINDS.includes(v as ModuleKindOrCommon)
}

/** 밖에서 온 조건을 검사하고 새 객체로 정리한다. null·undefined 는 「고를 때만」 */
export function checkCondition(input: unknown): ModuleCondition | null {
  if (input === null || input === undefined) return null
  const all = (input as { all?: unknown })?.all
  if (typeof input !== 'object' || !Array.isArray(all)) throw new ModuleInputError(CONTRACT_MODULE_MSG.badCondition)
  if (all.length > MAX_CONDITION_RULES) throw new ModuleInputError(CONTRACT_MODULE_MSG.tooManyRules(MAX_CONDITION_RULES))
  return {
    all: all.map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>
      const field = typeof r.field === 'string' ? r.field : ''
      if (!FIELD_PATTERN.test(field)) throw new ModuleInputError(CONTRACT_MODULE_MSG.badConditionField(field))
      if (!OPS.includes(r.op as ConditionOp)) throw new ModuleInputError(CONTRACT_MODULE_MSG.badCondition)
      const op = r.op as ConditionOp
      if (op === 'truthy') return { field, op }
      if (!Array.isArray(r.values) || r.values.length === 0 || !r.values.every((v) => typeof v === 'string')) {
        throw new ModuleInputError(CONTRACT_MODULE_MSG.badCondition)
      }
      return { field, op, values: [...(r.values as string[])] }
    }),
  }
}

function factOf(field: string, ctx: ModuleContext): string {
  if (field === 'direction') return ctx.direction
  if (field === 'businessTypeKey') return ctx.businessTypeKey ?? ''
  return (ctx.values[field.slice('value.'.length)] ?? '').trim()
}

/** 조건이 이 계약에 맞나. null 조건은 「고를 때만」이라 여기서는 false */
export function conditionHolds(cond: ModuleCondition | null, ctx: ModuleContext): boolean {
  if (!cond) return false
  return cond.all.every((r) => {
    const fact = factOf(r.field, ctx)
    if (r.op === 'truthy') return fact !== '' && fact !== '0' && fact.toLowerCase() !== 'false'
    const hit = (r.values ?? []).includes(fact)
    return r.op === 'in' ? hit : !hit
  })
}

/**
 * 이 계약에 들어갈 모듈. 공통은 늘, 고른 것은 고른 대로, 조건이 맞는 모듈은 안 골라도 들어간다.
 * 규제 모듈은 조건이 있으면 **조건이 정한다** — 골라도 조건이 안 맞으면 빠진다 (규제는 사실이 정한다).
 */
export function selectModules(
  modules: readonly ContractModule[], chosenKeys: readonly string[], ctx: ModuleContext,
): ContractModule[] {
  const chosen = new Set(chosenKeys)
  return modules.filter((m) => {
    if (m.kind === 'COMMON') return true
    if (m.kind === 'REGULATION' && m.enableWhen) return conditionHolds(m.enableWhen, ctx)
    return chosen.has(m.key) || conditionHolds(m.enableWhen, ctx)
  })
}
