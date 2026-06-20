// USAI 오케스트레이터 — Stage 1→6을 묶는다. AI 호출은 주입(callAI)해 단위테스트 가능.
// 1 표현(코드) → 2 구조발견(AI) → 3 블록추출(AI) → 4 정합(코드) → 5 검증(코드) → 6 분류(AI=2/3에 포함).
// 7 확정(사람)은 호출부(route)가 review_items 적재로 수행.
import { bufferToGrids, subGrid, type SheetGrid } from './intake-grid.ts'
import { compressGrids } from './grid-compress.ts'
import { reconcileRecords, type RawRecord } from './intake-reconcile.ts'
import { verifyItems, type VerifiedItem, type VerifyOptions } from './intake-verify.ts'

export interface DiscoveredBlock {
  block_id: string
  sheet: string
  bbox: string
  role: 'price_table' | 'contact_directory' | 'spec' | 'noise'
  header_cells?: string[]
  unit_hint?: string | null
  currency_hint?: string | null
  gpu_axis_hint?: number | null
  source_type_hint?: string | null
  confidence?: number
}

/** AI 호출 추상화 — (promptKey, context) → JSON 텍스트. route는 callGeminiOnce로 구현, 테스트는 fake. */
export type CallAI = (promptKey: string, context: string) => Promise<string>

export interface UsaiDeps {
  callAI: CallAI
  krwPerUsd: number
  verifyOptions?: VerifyOptions
}

export interface UsaiResult {
  items: VerifiedItem[]
  blocks: DiscoveredBlock[]
  meta: { sheets: number; priceBlocks: number; rawRecords: number }
}

// AI 응답에서 레코드 배열 추출 — {key:[...]} 객체형과 [...] 배열형 모두 허용(모델이 둘 다 반환).
// AI 응답은 신뢰경계 밖 — 프로토타입 오염 키 거부(H1) + 배열 길이 상한.
const MAX_AI_ITEMS = 1000
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
function safeReviver(k: string, v: unknown): unknown {
  return DANGEROUS_KEYS.has(k) ? undefined : v
}

export function extractArray(text: string, key: string): Record<string, unknown>[] {
  const cap = (a: unknown): Record<string, unknown>[] =>
    Array.isArray(a) ? (a.slice(0, MAX_AI_ITEMS) as Record<string, unknown>[]) : []
  // 1) 객체형 {key:[...]}
  const objMatch = text.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try {
      const obj = JSON.parse(objMatch[0], safeReviver) as Record<string, unknown>
      if (Array.isArray(obj[key])) return cap(obj[key])
    } catch { /* fall through */ }
  }
  // 2) 배열형 [...]
  const arrMatch = text.match(/\[[\s\S]*\]/)
  if (arrMatch) {
    try {
      return cap(JSON.parse(arrMatch[0], safeReviver))
    } catch { /* fall through */ }
  }
  return []
}

// AI 응답 텍스트에서 JSON 객체를 안전 파싱 — 마크다운 코드펜스/잡음을 건너뛰고 {...}만 파싱. 실패 시 null.
export function safeJson<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0]) as T
  } catch {
    return null
  }
}

function blockMetaLine(b: DiscoveredBlock): string {
  return `[블록 메타] unit_hint=${b.unit_hint ?? 'null'} currency_hint=${b.currency_hint ?? 'null'} gpu_axis_hint=${b.gpu_axis_hint ?? 'null'} source_type=${b.source_type_hint ?? 'unknown'}`
}

export async function orchestrateUsai(buf: ArrayBuffer, deps: UsaiDeps): Promise<UsaiResult> {
  // Stage 1 — 표현
  const grids: SheetGrid[] = bufferToGrids(buf)

  // Stage 2 — 구조발견(AI)
  const discoverCtx = compressGrids(grids).text
  const blocks = extractArray(await deps.callAI('gpu.intake-discover', discoverCtx), 'blocks') as unknown as DiscoveredBlock[]
  const priceBlocks = blocks.filter((b) => b.role === 'price_table')

  // Stage 3 — 블록별 추출(AI) + Stage 4 정합(코드)
  const allReconciled = []
  let rawRecordCount = 0
  for (const block of priceBlocks) {
    const sub = subGrid(grids, block.sheet, block.bbox)
    if (!sub || sub.cells.length === 0) continue
    const ctx = `${blockMetaLine(block)}\n\n${compressGrids([sub]).text}`
    const records = extractArray(await deps.callAI('gpu.intake-extract-block', ctx), 'records') as unknown as Partial<RawRecord>[]
    rawRecordCount += records.length

    const rawRecords: RawRecord[] = records
      .filter((r) => r.model_name && r.price_raw != null)
      .map((r) => ({
        model_name: String(r.model_name),
        model_addr: r.model_addr ?? '',
        price_raw: r.price_raw as number | string,
        price_addr: r.price_addr ?? '',
        currency_token: r.currency_token ?? block.currency_hint ?? null,
        unit_token: r.unit_token ?? block.unit_hint ?? null,
        gpu_count_hint: r.gpu_count_hint ?? block.gpu_axis_hint ?? null,
        term: r.term ?? null,
        block_id: block.block_id,
        source_type: r.source_type ?? block.source_type_hint ?? null,
        confidence: typeof r.confidence === 'number' ? r.confidence : (block.confidence ?? 0.5),
      }))

    const reconciled = reconcileRecords(rawRecords, {
      krwPerUsd: deps.krwPerUsd,
      blockCurrency: block.currency_hint ?? null,
      blockUnit: block.unit_hint ?? null,
      blockGpuCount: block.gpu_axis_hint ?? null,
    })
    allReconciled.push(...reconciled)
  }

  // Stage 5 — 검증(코드)
  const { all } = verifyItems(allReconciled, deps.verifyOptions)

  // dedup — 같은 (모델·약정·타깃·정규화단가) 중복 접기(KRW/USD 중복표·8장/1장 블록이 동일값으로 수렴).
  // 값이 다르면(불일치) 남겨 사람이 충돌을 보게 한다(조용한 병합 금지). DC-REV HIGH.
  const items = dedupVerified(all)

  return {
    items,
    blocks,
    meta: { sheets: grids.length, priceBlocks: priceBlocks.length, rawRecords: rawRecordCount },
  }
}

const dedupKey = (it: VerifiedItem): string =>
  `${it.model_name.toLowerCase().trim()}|${(it.target ?? '')}|${(it.term ?? '').toLowerCase().replace(/[\s_-]/g, '')}|${it.unit_price_usd.toFixed(4)}`

export function dedupVerified(items: VerifiedItem[]): VerifiedItem[] {
  const seen = new Set<string>()
  const out: VerifiedItem[] = []
  for (const it of items) {
    const k = dedupKey(it)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}
