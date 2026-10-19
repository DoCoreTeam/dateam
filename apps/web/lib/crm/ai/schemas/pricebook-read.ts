/**
 * 가격표 읽기 AI 출력 검사 — 모양이 틀린 칸은 null 로 접고, 줄 수는 자른다
 *
 * 던지지 않고 접는 이유: 한 줄이 틀렸다고 가격표 전체를 버리면 사람이 처음부터 친다.
 * 접힌 칸은 import-draft 가 「금액을 못 읽었어요」로 짚는다.
 */

import { z } from 'zod'
import type { PriceSheetRead } from '../../domain/pricebook/import-draft.ts'

const MAX_ITEMS = 200
const MAX_RULES = 100

const str = z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 300) : null), z.string().nullable())
const num = z.preprocess((v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') { const n = Number(v.replace(/[,\s원%]/g, '')); return Number.isFinite(n) && v.trim() !== '' ? n : null }
  return null
}, z.number().nullable())
const bool = z.preprocess((v) => (typeof v === 'boolean' ? v : null), z.boolean().nullable())
const list = <T extends z.ZodTypeAny>(s: T, max: number) => z.preprocess((v) => (Array.isArray(v) ? v.slice(0, max) : []), z.array(s))

const itemSchema = z.object({
  name: z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, 200) : ''), z.string()),
  section: str, price: num, basis: str, unit: str, billing: str, ratioPct: num, ratioOfSection: str,
  discountable: bool, remark: str, sourceText: str,
})

const schema = z.object({
  unit: z.preprocess((v) => (['원', '천원', '만원', '백만원', '억원'].includes(String(v)) ? v : null), z.enum(['원', '천원', '만원', '백만원', '억원']).nullable()),
  product: z.preprocess((v) => (v && typeof v === 'object' ? v : null), z.object({ name: z.preprocess((v) => String(v ?? '').slice(0, 200), z.string()), businessType: str }).nullable()),
  sections: list(z.object({ name: z.preprocess((v) => String(v ?? ''), z.string()), roundingUnitWon: num }), 20),
  items: list(itemSchema, MAX_ITEMS),
  rules: list(z.record(z.string(), z.unknown()), MAX_RULES),
  discounts: list(z.object({ label: z.preprocess((v) => String(v ?? ''), z.string()), companyKind: z.preprocess((v) => String(v ?? ''), z.string()), pct: z.preprocess((v) => Number(v), z.number()), confirmed: bool }), 20),
  examples: list(z.object({
    label: z.preprocess((v) => String(v ?? ''), z.string()),
    picked: list(z.string(), 50),
    gpus: list(z.object({ model: z.string(), count: z.preprocess((v) => Math.max(0, Math.trunc(Number(v) || 0)), z.number()), timed: z.preprocess((v) => v === true, z.boolean()) }), 20),
    nodes: num, expectOnce: num, expectAnnual: num, expectTco: num,
  }), 10),
  grades: list(z.object({ name: z.preprocess((v) => String(v ?? ''), z.string()), publicRate: num, price: num, effectiveFrom: str, sourceText: str }), 30),
  unclear: list(z.preprocess((v) => String(v ?? '').slice(0, 200), z.string()), 20),
})

/** 모델의 글에서 JSON 을 꺼낸다 — 앞뒤 설명이나 ``` 울타리가 붙어 와도 된다 */
export function parsePricebookRead(text: string): PriceSheetRead {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('가격표 읽기 결과에 JSON 이 없습니다')
  const raw = JSON.parse(text.slice(start, end + 1))
  return schema.parse(raw) as PriceSheetRead
}
