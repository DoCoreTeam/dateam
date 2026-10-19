/**
 * 창구로 들어온 값 → 엔진 모양 (순수 함수, 밖에서 온 값의 첫 관문)
 *
 * 화면이 걸러 보내지만 그 둘을 안 지나는 길이 생기면 음수 정상가, 101% 비율, 모르는 규칙이 들어온다.
 * 여기서 모양을 맞추고, 못 맞추면 던진다. 금액은 문자열로 받는다(2^53 을 넘는 원 단위).
 */

import { CrmError } from '../domain/errors.ts'
import { ITEM_BASES, RULE_KINDS, type GpuPick, type PriceItem, type PriceRule, type SolutionConditions } from '../domain/pricebook/types.ts'
import type { CompanyKind } from '../domain/company-kind.ts'

const COMPANY_KINDS: readonly CompanyKind[] = ['school', 'government', 'public', 'research', 'company', 'nonprofit']

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

function minorOrNull(v: unknown, field: string): bigint | null {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).replace(/,/g, '').trim()
  if (!/^\d+$/.test(s)) throw new CrmError('VALIDATION_FAILED', '금액은 0 이상의 정수(원)여야 해요.', { field })
  return BigInt(s)
}

function pctOrNull(v: unknown, field: string): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new CrmError('VALIDATION_FAILED', '비율은 0에서 100 사이여야 해요.', { field })
  return n
}

export function parseItem(body: Record<string, unknown>): Omit<PriceItem, 'id'> & { id?: string } {
  const name = str(body.name)
  if (!name) throw new CrmError('VALIDATION_FAILED', '품목 이름을 입력해 주세요.', { field: 'name' })
  const basis = ITEM_BASES.includes(body.basis as PriceItem['basis']) ? (body.basis as PriceItem['basis']) : 'FIXED'
  const listPriceMinor = basis === 'SURVEY' || basis === 'RATIO' ? null : (minorOrNull(body.listPriceMinor, 'listPriceMinor') ?? BigInt(0))
  const ratioPct = basis === 'RATIO' ? pctOrNull(body.ratioPct, 'ratioPct') : null
  if (basis === 'RATIO' && ratioPct === null) throw new CrmError('VALIDATION_FAILED', '비율 품목은 비율(%)을 넣어 주세요.', { field: 'ratioPct' })
  const taxRate = pctOrNull(body.taxRate, 'taxRate') ?? 10
  return {
    ...(typeof body.id === 'string' && body.id ? { id: body.id } : {}),
    name,
    section: str(body.section) ?? '기타',
    listPriceMinor,
    basis,
    unit: str(body.unit),
    billing: body.billing === 'ANNUAL' ? 'ANNUAL' : 'ONCE',
    ratioPct,
    ratioOfSection: basis === 'RATIO' ? str(body.ratioOfSection) : null,
    discountable: body.discountable !== false,
    taxRate,
    remark: str(body.remark),
    needsReview: false,
  }
}

export function parseRules(v: unknown): PriceRule[] {
  if (!Array.isArray(v)) throw new CrmError('VALIDATION_FAILED', '규칙 목록이 필요해요.', { field: 'rules' })
  if (v.length > 200) throw new CrmError('VALIDATION_FAILED', '규칙이 너무 많아요.', { field: 'rules' })
  return v.map((r, i) => {
    if (typeof r !== 'object' || r === null || !RULE_KINDS.includes((r as { kind?: unknown }).kind as PriceRule['kind'])) {
      throw new CrmError('VALIDATION_FAILED', `${i + 1}번째 규칙의 종류를 알 수 없어요.`, { field: 'rules' })
    }
    // 본문 모양은 저장할 때 checkRules 가 보고, 틀리면 끈 채로 저장한다
    return JSON.parse(JSON.stringify(r)) as PriceRule
  })
}

function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function parseConditions(v: unknown): SolutionConditions | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'object') throw new CrmError('VALIDATION_FAILED', '조건 모양이 틀렸어요.', { field: 'conditions' })
  const c = v as Record<string, unknown>
  const picked = Array.isArray(c.picked) ? c.picked.filter((x): x is string => typeof x === 'string').slice(0, 100) : []
  const gpus: GpuPick[] = Array.isArray(c.gpus)
    ? c.gpus.slice(0, 50).flatMap((g) => {
      if (typeof g !== 'object' || g === null) return []
      const x = g as Record<string, unknown>
      const model = str(x.model)
      const count = intOrNull(x.count)
      if (!model || count === null) return []
      const cls = ['DC', 'WS', 'CONSUMER', 'NPU'].includes(String(x.classOverride)) ? (x.classOverride as GpuPick['classOverride']) : null
      return [{ model, count, timed: x.timed === true, classOverride: cls }]
    })
    : []
  const kind = COMPANY_KINDS.includes(c.companyKind as CompanyKind) ? (c.companyKind as CompanyKind) : null
  const d = c.discount
  const discount: SolutionConditions['discount'] = typeof d === 'number' && d >= 0 && d <= 100 ? d : d === 'none' ? 'none' : 'auto'
  return { picked, gpus, nodes: intOrNull(c.nodes), training: intOrNull(c.training), companyKind: kind, discount }
}
