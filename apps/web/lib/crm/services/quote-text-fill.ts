/**
 * 글로 채우기 (서비스) — 견적 옆 편집기의 글을 표로
 *
 * 순서는 고정이다. 규칙이 먼저 읽고, 가격 기준을 읽고, 규칙이 못 읽은 조각이 있을 때만 AI 를 부르고,
 * 엔진이 조립하고, 지금 표와 맞추고, 규칙이 고쳐 둔다(`domain/quote-text/text-fill.ts`).
 *
 * **저장하지 않는다.** 화면이 결과를 초안에 얹고 사람이 저장한다.
 * **AI 가 실패해도 던지지 않는다.** 규칙으로 읽은 만큼은 표에 들어가고 `aiStatus` 가 그 사실을 말한다.
 * 같은 조각이면 AI 를 다시 부르지 않는다 — 화면이 지난 답(`aiCache`)을 들고 오고, 여기서 다시 거른다.
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { getCrmDb, type CrmDb } from '../db/client.ts'
import { CrmError } from '../domain/errors.ts'
import { runAi, type AiAdapter } from '../ai/runner.ts'
import { QUOTE_TEXT_READ_V1 } from '../ai/prompts/quote-text-read.v1.ts'
import { QUOTE_TEXT_REVIEW_V1 } from '../ai/prompts/quote-text-review.v1.ts'
import { parseReview, reviewToFixes, type ReviewFix, type ReviewNotice, type ReviewOutput, type TextReviewInput } from '../ai/schemas/quote-text-review.ts'
import {
  applyAiReadings, buildTextReadInput, parseTextRead, TextReadOutputSchema,
  type AliasCandidate, type TextReadOutput,
} from '../ai/schemas/quote-text-read.ts'
import type { CompanyKind } from '../domain/company-kind.ts'
import { MAX_TEXT_LENGTH, readText, type Catalog } from '../domain/quote-text/read-rules.ts'
import type { ComposeContext, StandaloneItem } from '../domain/quote-text/compose-from-text.ts'
import { runTextFill, type ClientLine, type TextFillResult } from '../domain/quote-text/text-fill.ts'
import type { GpuPriceRef } from '../domain/pricebook/basis-lines.ts'
import type { PriceProduct } from '../domain/pricebook/types.ts'
import { listPriceProducts, loadEngineProduct } from './pricebook.ts'
import { listLaborGrades, toGradeRefs } from './labor-grade.ts'
import { adapterFromSetting } from './quick-create.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

const MAX_LINES = 200
const MAX_ITEMS = 500
const COMPANY_KINDS = ['school', 'government', 'public', 'research', 'company', 'nonprofit'] as const

const str = (max: number) => z.preprocess((v) => (v === null || v === undefined ? '' : String(v)).slice(0, max), z.string())
const nullableStr = (max: number) => z.preprocess((v) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, max)), z.string().nullable())

const ClientLineSchema = z.object({
  key: str(120), textKey: nullableStr(200), itemId: nullableStr(60), name: str(300), kind: str(20),
  section: nullableStr(120), quantity: str(30), unit: str(30), unitPriceMinor: str(30), listPriceMinor: nullableStr(30),
  durationValue: str(30), durationUnit: str(10), ratioPct: nullableStr(10), ratioOfSectionName: nullableStr(120),
  remark: str(300), discountPercent: str(10),
  lockedFields: z.array(z.string().max(20)).max(10).default([]),
})

export const TextFillInputSchema = z.object({
  text: z.string().max(MAX_TEXT_LENGTH),
  lines: z.array(ClientLineSchema).max(MAX_LINES).default([]),
  companyKind: z.enum(COMPANY_KINDS).nullable().default(null),
  /** auto: 못 읽은 조각이 있으면 AI, off: 규칙만 */
  ai: z.enum(['auto', 'off']).default('auto'),
  /** fill: 글을 표로, review: 사람이 「AI로 한 번 더 보기」를 눌렀을 때만 */
  mode: z.enum(['fill', 'review']).default('fill'),
  aiCache: z.object({ key: z.string().max(80), output: z.unknown() }).nullable().default(null),
})
export type TextFillInput = z.infer<typeof TextFillInputSchema>

export type AiStatus = 'NOT_NEEDED' | 'OFF' | 'CACHED' | 'OK' | 'QUOTA' | 'BUDGET' | 'FAILED'

export interface TextFillResponse extends TextFillResult {
  aiStatus: AiStatus
  /** AI 가 읽은 조각(「줄.조각」) — 화면이 「AI 가 읽음」을 표시한다 */
  byAi: string[]
  aliases: AliasCandidate[]
  aiCache: { key: string; output: TextReadOutput } | null
  runId: string | null
}

export function parseTextFillInput(body: unknown): TextFillInput {
  const r = TextFillInputSchema.safeParse(body)
  if (!r.success) throw new CrmError('VALIDATION_FAILED', '글로 채우기 입력이 올바르지 않습니다.', { field: r.error.issues[0]?.path.join('.') ?? 'text' })
  return r.data
}

async function loadCatalog(db: CrmDb): Promise<{ catalog: Catalog; products: PriceProduct[]; items: StandaloneItem[] }> {
  const rows = await listPriceProducts(db)
  const products = await Promise.all(rows.map((r) => loadEngineProduct(db, r.id)))
  const loose = await (db as Tx).crmProduct.findMany({
    where: { priceProductId: null, isActive: true },
    select: { id: true, name: true, unit: true, unitPriceMinor: true, section: true, taxRate: true, aliases: true, needsReview: true },
    orderBy: [{ name: 'asc' }],
    take: MAX_ITEMS,
  })
  const aliasOf = new Map<string, string[]>(loose.map((i: Tx) => [i.id, i.aliases ?? []]))
  const productAliases = await (db as Tx).crmProduct.findMany({
    where: { priceProductId: { in: products.map((p) => p.id) } }, select: { id: true, aliases: true },
  })
  for (const a of productAliases) aliasOf.set(a.id, a.aliases ?? [])
  return {
    products,
    catalog: {
      products: products.map((p) => ({ id: p.id, name: p.name, items: p.items.map((i) => ({ id: i.id, name: i.name, aliases: aliasOf.get(i.id) ?? [] })) })),
      items: loose.map((i: Tx) => ({ id: i.id, name: i.name, aliases: i.aliases ?? [] })),
    },
    items: loose.map((i: Tx) => ({
      id: i.id, name: i.name, unit: i.unit ?? null,
      // 확인 전 가격은 자동 채움의 기준으로 쓰지 않는다
      listPriceMinor: i.needsReview ? null : BigInt(i.unitPriceMinor ?? 0),
      section: i.section ?? null, taxRate: Number(i.taxRate ?? 10),
    })),
  }
}

function cacheKey(input: ReturnType<typeof buildTextReadInput>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 40)
}

function statusOf(e: unknown): AiStatus {
  const code = e instanceof CrmError ? e.code : null
  if (code === 'PROVIDER_QUOTA') return 'QUOTA'
  if (code === 'BUDGET_BLOCKED') return 'BUDGET'
  return 'FAILED'
}

export interface TextFillDeps {
  adapter?: AiAdapter
  /** GPU 가격표 판매가 — 없으면 GPU 이용 줄은 「가격표에 없음」 */
  gpuPrice?: (db: CrmDb) => Promise<(model: string) => GpuPriceRef | null>
}

export interface Loaded {
  catalog: Catalog
  products: PriceProduct[]
  items: StandaloneItem[]
  laborGrades: ComposeContext['laborGrades']
  gpuPrice: (model: string) => GpuPriceRef | null
}

export type CallAi = (input: ReturnType<typeof buildTextReadInput>) => Promise<{ output: TextReadOutput; runId: string | null }>

/** 몸통 — DB 와 AI 를 받아서 쓴다. 시험은 가짜 AI 로 호출 수를 센다 */
export async function fillCore(loaded: Loaded, input: TextFillInput, callAi: CallAi): Promise<TextFillResponse> {
  const { catalog, products, items } = loaded
  const ruleReadings = readText(input.text, catalog)
  const readInput = buildTextReadInput(ruleReadings, catalog)
  const key = cacheKey(readInput)

  let finalReadings = ruleReadings
  let aiStatus: AiStatus = readInput.clauses.length === 0 ? 'NOT_NEEDED' : input.ai === 'off' ? 'OFF' : 'OK'
  let output: TextReadOutput | null = null
  let runId: string | null = null

  if (aiStatus === 'OK') {
    const cached = input.aiCache?.key === key ? TextReadOutputSchema.safeParse(input.aiCache.output) : null
    if (cached?.success) {
      output = cached.data
      aiStatus = 'CACHED'
    } else {
      try {
        const r = await callAi(readInput)
        output = r.output
        runId = r.runId
      } catch (e) {
        aiStatus = statusOf(e)
      }
    }
  }
  let aliases: AliasCandidate[] = []
  let byAi: string[] = []
  if (output) {
    const applied = applyAiReadings(ruleReadings, output, catalog)
    finalReadings = applied.readings
    aliases = applied.aliases
    byAi = applied.byAi
  }

  const ctx: ComposeContext = {
    products, items, laborGrades: loaded.laborGrades, gpuPrice: loaded.gpuPrice, companyKind: input.companyKind as CompanyKind | null,
  }
  const result = runTextFill(ruleReadings, finalReadings, ctx, input.lines as ClientLine[], products)
  return { ...result, aiStatus, byAi, aliases, aiCache: output ? { key, output } : null, runId }
}

export async function fillQuoteFromText(
  workspaceId: string,
  actorId: string | null,
  input: TextFillInput,
  deps: TextFillDeps = {},
): Promise<TextFillResponse> {
  const db = getCrmDb(workspaceId)
  const [{ catalog, products, items }, grades, gpuPrice] = await Promise.all([
    loadCatalog(db),
    listLaborGrades(db),
    deps.gpuPrice ? deps.gpuPrice(db) : Promise.resolve(() => null),
  ])
  const callAi: CallAi = async (readInput) => {
    const chosen = deps.adapter ?? await adapterFromSetting(db, { actorId })
    const r = await runAi<TextReadOutput>({
      actorId, db, workspaceId, kind: 'QUICK_CREATE',
      prompt: QUOTE_TEXT_READ_V1,
      input: JSON.stringify(readInput),
      inputRef: { clauses: readInput.clauses.length, chars: input.text.length },
      parse: parseTextRead,
      adapter: chosen,
    })
    return { output: r.output, runId: r.runId }
  }
  return fillCore({ catalog, products, items, laborGrades: toGradeRefs(grades), gpuPrice }, input, callAi)
}

// ── AI 검토 — 사람이 누를 때만 ──────────────────────────────────────────────

export interface TextReviewResponse {
  aiStatus: AiStatus
  fixes: ReviewFix[]
  notices: ReviewNotice[]
  runId: string | null
}

export type CallReview = (input: TextReviewInput) => Promise<{ output: ReviewOutput; runId: string | null }>

/** 금액은 싣지 않는다 — 이름, 수량, 단위, 묶음만 */
export function buildReviewInput(input: TextFillInput): TextReviewInput {
  return {
    text: input.text,
    lines: input.lines.map((l) => ({ key: l.key, name: l.name, quantity: l.quantity, unit: l.unit, section: l.section })),
  }
}

export async function reviewCore(input: TextFillInput, callAi: CallReview): Promise<TextReviewResponse> {
  if (input.text.trim() === '' || input.lines.length === 0) return { aiStatus: 'NOT_NEEDED', fixes: [], notices: [], runId: null }
  try {
    const r = await callAi(buildReviewInput(input))
    return { aiStatus: 'OK', ...reviewToFixes(r.output, input.lines), runId: r.runId }
  } catch (e) {
    return { aiStatus: statusOf(e), fixes: [], notices: [], runId: null }
  }
}

export async function reviewQuoteText(workspaceId: string, actorId: string | null, input: TextFillInput, deps: Pick<TextFillDeps, 'adapter'> = {}): Promise<TextReviewResponse> {
  const db = getCrmDb(workspaceId)
  return reviewCore(input, async (reviewInput) => {
    const chosen = deps.adapter ?? await adapterFromSetting(db, { actorId })
    const r = await runAi<ReviewOutput>({
      actorId, db, workspaceId, kind: 'QUICK_CREATE',
      prompt: QUOTE_TEXT_REVIEW_V1,
      input: JSON.stringify(reviewInput),
      inputRef: { lines: reviewInput.lines.length, chars: input.text.length },
      parse: parseReview,
      adapter: chosen,
    })
    return { output: r.output, runId: r.runId }
  })
}
