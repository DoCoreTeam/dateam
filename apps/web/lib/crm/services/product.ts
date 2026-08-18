/**
 * 상품 카탈로그 (견적 항목의 재료)
 *
 * **왜 이제야 생겼나**: `CrmProduct` 테이블도 `CrmQuoteLine.productId` 컬럼도 스키마에 있었다.
 * 그런데 **읽는 코드가 없었다.** 그래서 견적을 쓸 때마다 품목 이름·단가·단위·세율을
 * 손으로 다시 쳤고, `productId` 는 언제나 null 이었다.
 * 만들어 두고 아무도 안 쓰는 상태 — 이 저장소에서 반복된 함정이다(v0.7.438).
 *
 * **검색은 서버가 한다.** 앞 100건만 받아 화면에서 거르면 101번째 상품은 영영 못 찾는다.
 * 그게 회사 목록에서 실제로 났던 사고다(v0.7.560 RecordPicker 주석 참조).
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { normalizeText, requireText } from '../domain/normalize.ts'

export interface ProductRow {
  id: string
  name: string
  sku: string | null
  unitPriceMinor: bigint
  currency: string
  taxRate: string
  unit: string | null
  descriptionMd: string | null
  isActive: boolean
}

const SELECT = {
  id: true, name: true, sku: true, unitPriceMinor: true,
  currency: true, taxRate: true, unit: true, descriptionMd: true, isActive: true,
} as const

/**
 * 고르는 화면이 한 번에 받는 최대 개수.
 *
 * 상한 자체는 필요하다(카탈로그가 커져도 모달이 안 터진다). 다만 **상한이 있다는 것과
 * 못 찾는다는 것은 다르다** — 검색어가 서버로 가므로 101번째 상품도 이름을 치면 나온다.
 */
const SEARCH_LIMIT = 50

export interface ListProductInput {
  /** 이름·SKU 부분 일치. 비면 최근 것부터 */
  q?: string | null
  /** 그만 파는 상품까지 볼 것인가 — 기본은 파는 것만 */
  includeInactive?: boolean
}

export async function listProducts(db: CrmDb, input: ListProductInput = {}): Promise<ProductRow[]> {
  const q = normalizeText(input.q)
  const where: Record<string, unknown> = {}
  if (!input.includeInactive) where.isActive = true
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { sku: { contains: q, mode: 'insensitive' } },
    ]
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmProduct.findMany({
    where,
    select: SELECT,
    orderBy: [{ name: 'asc' }],
    take: SEARCH_LIMIT,
  })
  return rows as ProductRow[]
}

export interface CreateProductInput {
  name: string
  sku?: string | null
  unitPriceMinor?: string | number | null
  currency?: string | null
  taxRate?: string | number | null
  unit?: string | null
  descriptionMd?: string | null
}

/**
 * 상품을 만든다.
 *
 * **견적을 쓰다 만드는 길이 주 경로다.** "H100 80GB SXM" 을 치는데 카탈로그에 없으면
 * 거기서 만들 수 있어야 한다 — 설정 화면으로 보내면 쓰던 견적을 잃는다.
 * 그래서 이름 하나만으로도 만들어진다. 단가·단위는 견적에서 채우고, 다음부터 검색으로 찾는다.
 */
export async function createProduct(
  workspaceId: string,
  actorId: string | null,
  input: CreateProductInput,
  defaultCurrency = 'KRW',
): Promise<ProductRow> {
  const name = requireText(input.name)
  if (!name) throw new CrmError('VALIDATION_FAILED', '품목 이름을 입력해 주세요.', { field: 'name' })

  const unitPriceMinor = toMinor(input.unitPriceMinor)
  const taxRate = toRate(input.taxRate)

  return withCrmTx(workspaceId, async (tx) => {
    // 같은 이름이 두 벌 생기면 견적마다 다른 것을 고르게 된다 — 있으면 그걸 준다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (tx as any).crmProduct.findFirst({
      where: { name, isActive: true }, select: SELECT,
    })
    if (existing) return existing as ProductRow

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const made = await (tx as any).crmProduct.create({
      data: {
        name,
        sku: normalizeText(input.sku),
        unitPriceMinor,
        currency: (normalizeText(input.currency) || defaultCurrency).toUpperCase().slice(0, 3),
        taxRate,
        unit: normalizeText(input.unit),
        descriptionMd: input.descriptionMd?.trim() || null,
      },
      select: SELECT,
    })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'product.created',
      targetType: 'product', targetId: made.id,
      afterJson: { name, unitPriceMinor: unitPriceMinor.toString(), taxRate },
    })
    return made as ProductRow
  })
}

/** 금액은 문자열로 받는다 — number 로 받으면 2^53 을 넘는 원 단위 금액이 조용히 틀어진다 */
function toMinor(v: string | number | null | undefined): bigint {
  if (v === null || v === undefined || v === '') return BigInt(0)
  try {
    const b = BigInt(typeof v === 'number' ? Math.round(v) : String(v).trim())
    return b < BigInt(0) ? BigInt(0) : b
  } catch {
    return BigInt(0)
  }
}

function toRate(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 10
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 100) return 10
  return n
}

/** 화면으로 나가는 모양 — BigInt 를 문자열로 바꾸지 않으면 JSON.stringify 가 그 자리에서 던진다 */
export function toProductJson(row: ProductRow): Record<string, unknown> {
  return {
    ...row,
    unitPriceMinor: row.unitPriceMinor.toString(),
    taxRate: String(row.taxRate),
  }
}
