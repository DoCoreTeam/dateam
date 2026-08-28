/**
 * 견적 서비스
 *
 * **왜 만들었나**: 딜에 금액 칸은 있는데 그 금액이 어디서 나왔는지 적을 곳이 없었다.
 * 영업은 "얼마"를 항목으로 쪼개 제시하고(무엇을 몇 개, 단가 얼마, 할인 얼마),
 * 그 문서가 협상의 기준이 된다. 자리가 없으면 금액은 사람 머릿속에만 남는다.
 *
 * 이 파일이 지키는 것 셋:
 *
 *   1) **금액은 서버만 계산한다.** 화면이 보낸 합계는 받지도 않는다.
 *      계산은 domain/quote-math.ts 한 곳에 있고 화면은 미리보기 용도로만 같은 함수를 부른다.
 *      화면이 계산한 값을 저장하면, 브라우저를 조작한 만큼 총액이 바뀐다.
 *
 *   2) **보낸 견적은 변하지 않는다.** 항목의 이름·단가는 카탈로그를 참조하지 않고 **복사**한다.
 *      카탈로그 가격을 올렸더니 지난달 고객에게 보낸 견적서 금액이 따라 오르는 일이 없어야 한다.
 *      상태가 DRAFT 가 아니면 항목·금액을 고칠 수 없다(고치려면 EXPIRED→DRAFT 이거나 새 견적).
 *
 *   3) **할인은 임계를 넘으면 승인을 받아야 보낼 수 있다.** 판정은 quote-math.needsApproval,
 *      전이 판정은 state-machines.canTransitQuote — 화면이 같은 판정을 다시 구현하지 않는다.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { normalizeText, requireText } from '../domain/normalize.ts'
import { assertTransit, type QuoteStatus } from '../domain/state-machines.ts'
import { assertUpdated, lockWhere, BUMP_VERSION } from '../db/optimistic.ts'
import { planDelete, type DeleteMode } from '../domain/soft-delete.ts'
import {
  clampLimit, decodeCursor, cursorWhere, CURSOR_ORDER, toPage, countIfFirstPage,
  type CursorInput, type CursorPage,
} from '../db/cursor.ts'
import {
  computeLine, computeTotals, needsApproval, discountRateOf,
  formatQuoteNo, seqOfQuoteNo, isExpired,
  DEFAULT_DISCOUNT_APPROVAL_PCT,
  type QuoteLineInput,
} from '../domain/quote-math.ts'

// ------------------------------------------------------------
// 모양
// ------------------------------------------------------------

export interface QuoteLineRow {
  id: string
  productId: string | null
  /** 라인 종류 여섯. 종류마다 «수량·단가»가 뜻하는 것이 다르다 */
  kind: string
  /** 공수 라인: 역할·등급 */
  roleLabel: string | null
  laborGradeId: string | null
  name: string
  descriptionMd: string | null
  quantity: string
  unit: string | null
  unitPriceMinor: bigint
  discountPercent: string
  taxRate: string
  lineTotalMinor: bigint
  position: number
}

export interface QuoteRow {
  id: string
  dealId: string
  quoteNo: string
  title: string
  status: string
  currency: string
  validUntil: Date | null
  subtotalMinor: bigint
  discountMinor: bigint
  taxMinor: bigint
  totalMinor: bigint
  approvalRequired: boolean
  approvedById: string | null
  approvedAt: Date | null
  notesMd: string | null
  /** 이 견적이 고른 거래 조건. 순서가 곧 인쇄 순서다 */
  termIds: string[]
  ownerId: string | null
  sentAt: Date | null
  decidedAt: Date | null
  version: number
  createdAt: Date
  updatedAt: Date
  /** 유효기간이 지났는가 — 읽는 시점에 판정한다(배치가 아니다) */
  expired?: boolean
  lines?: QuoteLineRow[]
}

const LINE_SELECT = {
  id: true, productId: true, name: true, descriptionMd: true, quantity: true, unit: true,
  unitPriceMinor: true, discountPercent: true, taxRate: true, lineTotalMinor: true, position: true,
  kind: true, roleLabel: true, laborGradeId: true,
} as const

const SELECT = {
  id: true, dealId: true, quoteNo: true, title: true, status: true, currency: true,
  validUntil: true, subtotalMinor: true, discountMinor: true, taxMinor: true, totalMinor: true,
  approvalRequired: true, approvedById: true, approvedAt: true, notesMd: true,
  // createdById 는 **담당자(영업대표)**를 정하는 데 쓴다 — ownerId 가 비면 만든 사람이 담당이다
  termIds: true, ownerId: true, createdById: true, recipientPersonId: true,
  sentAt: true, decidedAt: true, version: true, createdAt: true, updatedAt: true,
} as const

// ------------------------------------------------------------
// 입력 정규화
// ------------------------------------------------------------

export interface QuoteLineData {
  /** 기존 항목이면 id. 없으면 새로 만든다 */
  id?: string | null
  productId?: string | null
  /** 라인 종류. 안 주면 수량 라인으로 본다(지금까지의 유일한 종류) */
  kind?: string | null
  roleLabel?: string | null
  laborGradeId?: string | null
  name: string
  descriptionMd?: string | null
  quantity: number | string
  unit?: string | null
  unitPriceMinor: number | string
  discountPercent?: number | string | null
  taxRate?: number | string | null
}

/**
 * 이 요청에 써도 되는 이름들.
 *
 * **왜 화이트리스트인가**: 예전엔 모르는 필드를 조용히 버렸다. 그래서 `unitPrice` 처럼
 * 이름을 한 글자 틀리면 단가가 **0 으로 들어가고 200 이 떨어졌다** — 0원짜리 견적이
 * 아무 말 없이 생긴다(G3 실측: 본인 입력 오류로 겪음).
 * 0원 항목 자체는 정당하다(무상 제공). 그러니 **0을 막는 게 아니라 오타를 막는다.**
 */
const LINE_KEYS = new Set([
  'id', 'productId', 'name', 'descriptionMd', 'quantity', 'unit',
  'unitPriceMinor', 'discountPercent', 'taxRate',
  'kind', 'roleLabel', 'laborGradeId',
])
const QUOTE_KEYS = new Set([
  'dealId', 'title', 'currency', 'validUntil', 'notesMd', 'ownerId', 'lines', 'termIds',
  'recipientPersonId',
  // 수정 경로가 함께 보내는 것들
  'version', 'status',
])

/** 모르는 이름이 섞여 있으면 **거절한다** — 조용히 버리면 보낸 쪽은 반영된 줄 안다 */
function rejectUnknownKeys(obj: unknown, allowed: Set<string>, where: string): void {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return
  const unknown = Object.keys(obj as Record<string, unknown>).filter((k) => !allowed.has(k))
  if (unknown.length === 0) return
  throw new CrmError(
    'VALIDATION_FAILED',
    `${where}에 모르는 항목이 있습니다: ${unknown.join(', ')}. 이름을 확인해 주세요.`,
    { field: unknown[0] },
  )
}

/** 금액은 문자열로 받는다 — number 로 받으면 2^53 을 넘는 원 단위 금액이 조용히 틀어진다 */
function toMinor(v: number | string | null | undefined, field: string): bigint {
  if (v === null || v === undefined || v === '') return BigInt(0)
  try {
    const b = BigInt(typeof v === 'number' ? Math.round(v) : String(v).trim())
    if (b < BigInt(0)) throw new Error('negative')
    return b
  } catch {
    throw new CrmError('VALIDATION_FAILED', '금액은 0 이상의 정수여야 합니다.', { field })
  }
}

function toRate(v: number | string | null | undefined, field: string, fallback: number): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) {
    throw new CrmError('VALIDATION_FAILED', '비율은 숫자여야 합니다.', { field })
  }
  if (n < 0 || n > 100) {
    throw new CrmError('VALIDATION_FAILED', '비율은 0에서 100 사이여야 합니다.', { field })
  }
  return n
}

function toQuantity(v: number | string | null | undefined): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) {
    throw new CrmError('VALIDATION_FAILED', '수량은 0보다 커야 합니다.', { field: 'quantity' })
  }
  // Decimal(12,3) — 소수 넷째 자리부터는 DB 가 잘라 버리므로 여기서 맞춰 둔다
  return Math.round(n * 1000) / 1000
}

/** 항목 하나를 DB 에 넣을 모양으로. 합계는 여기서 **서버가** 계산한다 */
function toLineData(line: QuoteLineData, position: number): Record<string, unknown> {
  rejectUnknownKeys(line, LINE_KEYS, `${position + 1}번째 항목`)
  const name = requireText(line.name)
  if (!name) {
    throw new CrmError('VALIDATION_FAILED', '항목 이름을 입력해 주세요.', { field: 'name' })
  }
  const quantity = toQuantity(line.quantity)
  const unitPriceMinor = toMinor(line.unitPriceMinor, 'unitPriceMinor')
  const discountPercent = toRate(line.discountPercent, 'discountPercent', 0)
  const taxRate = toRate(line.taxRate, 'taxRate', 10)

  const amounts = computeLine({ quantity, unitPriceMinor, discountPercent, taxRate })

  return {
    productId: line.productId || null,
    name,
    descriptionMd: normalizeText(line.descriptionMd),
    quantity,
    unit: normalizeText(line.unit),
    unitPriceMinor,
    discountPercent,
    taxRate,
    lineTotalMinor: amounts.lineTotalMinor,
    position,
  }
}

// ------------------------------------------------------------
// 조회
// ------------------------------------------------------------

/**
 * 딜 하나의 견적 목록.
 *
 * 커서를 쓰지 않는다: 딜 하나에 견적이 수백 건 붙는 일은 없다.
 * 여기에 페이지네이션을 넣으면 화면만 복잡해지고 얻는 것이 없다.
 */
export async function listQuotesByDeal(
  db: CrmDb,
  dealId: string,
  opts: { trash?: boolean } = {},
): Promise<QuoteRow[]> {
  // 휴지통은 별도 화면이 아니라 필터다 — 가드의 기본 필터를 일부러 뒤집는다
  const where = opts.trash ? { dealId, deletedAt: { not: null } } : { dealId }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmQuote.findMany({
    where,
    select: SELECT,
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  const now = new Date()
  return (rows as QuoteRow[]).map((r) => ({ ...r, expired: markExpired(r, now) }))
}

/** SENT 인 견적만 기간을 따진다 — 초안은 만료라는 말이 성립하지 않는다 */
function markExpired(row: Pick<QuoteRow, 'status' | 'validUntil'>, now: Date): boolean {
  if (row.status !== 'SENT') return false
  return isExpired(row.validUntil, now)
}

/** 견적 목록 한 줄 — 딜·회사 이름을 함께 준다(번호만 보면 무슨 건인지 모른다) */
export interface QuoteListRow extends QuoteRow {
  dealName: string
  companyName: string | null
}

/**
 * 목록 필터로 받을 수 있는 상태 전부.
 *
 * 'EXPIRED' 는 DB enum 에 없다 — 저장된 상태는 SENT 인 채로 유효기간만 지난 것이다.
 * 그래도 **사용자는 그걸 상태로 부른다.** 그래서 필터에서는 받고, 아래에서 조건으로 번역한다.
 */
const ALL_QUOTE_STATUS = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']

export interface ListQuoteInput extends CursorInput {
  /** 견적번호·제목·딜 이름 부분 일치 */
  q?: string | null
  /** 상태 하나로 좁히기. 'EXPIRED' 는 저장된 상태가 아니라 **읽는 시점 판정**이라 따로 다룬다 */
  status?: string | null
  trash?: boolean
}

/**
 * 워크스페이스 전체 견적 목록.
 *
 * **왜 열었나**: 예전엔 `dealId` 없이 부르면 거절했다("어느 딜의 견적인지 알려 주세요").
 * 그래서 견적은 딜 상세 안에서만 존재했고, 사이드바에서는 보이지 않았다 —
 * 사용자가 "견적도 아직 없고"라고 말한 게 이것이다. 물건은 있는데 갈 길이 없었다.
 *
 * `listQuotesByDeal` 은 그대로 둔다(딜 상세는 커서가 필요 없다). 여기만 추가한다.
 */
export async function listQuotes(
  db: CrmDb,
  input: ListQuoteInput = {},
): Promise<CursorPage<QuoteListRow>> {
  const limit = clampLimit(input.limit)
  const decoded = decodeCursor(input.cursor)
  const q = normalizeText(input.q)

  const status = normalizeText(input.status)
  /**
   * 모르는 상태는 **여기서 막는다.**
   * 그대로 넘기면 Prisma 가 enum 에서 던지고 화면은 500 에 "잠시 후 다시 시도해 주세요"를 받는다 —
   * 다시 시도해도 영원히 같다. 무엇이 잘못됐는지 사람이 읽을 수 있어야 고칠 수 있다.
   */
  if (status && !ALL_QUOTE_STATUS.includes(status)) {
    throw new CrmError(
      'VALIDATION_FAILED',
      `모르는 견적 상태입니다: ${status}. ${ALL_QUOTE_STATUS.join(' · ')} 중에서 골라 주세요.`,
      { field: 'status' },
    )
  }

  const where: Record<string, unknown> = {}
  if (input.trash) where.deletedAt = { not: null }
  if (status && status !== 'SENT' && status !== 'EXPIRED') where.status = status
  /**
   * '보냄' 과 '기한 지남' 은 **겹치지 않는다.**
   *
   * 만료는 컬럼이 아니다 — 저장된 status 는 SENT 인 채로 유효기간만 지난 것이다.
   * 예전엔 그래서 같은 견적이 두 필터에 다 나왔고, **목록의 배지는 '기한 지남'인데
   * 그걸 뽑아낸 필터는 '보냄'** 이었다. 화면이 자기 말을 뒤집는 셈이다(G3 관찰 ①).
   * 이제 '보냄'은 나가 있고 **아직 살아 있는 것**, '기한 지남'은 나갔는데 **끝난 것**이다.
   */
  const now = new Date()
  if (status === 'SENT') {
    where.status = 'SENT'
    where.NOT = { validUntil: { lt: now } }   // 기한이 지난 것만 뺀다(기한 없음은 남는다)
  }
  if (status === 'EXPIRED') {
    where.status = 'SENT'
    where.validUntil = { lt: now }
  }
  /**
   * 검색은 **AND 로 따로 묶는다.**
   * where.OR 에 그냥 넣으면 상태 조건이 쓰는 OR 를 덮어써서
   * "보냄 + 검색어"가 조용히 "검색어만"이 된다 — 필터를 걸었는데 안 걸린 결과가 나온다.
   */
  const search = q
    ? {
      OR: [
        { quoteNo: { contains: q, mode: 'insensitive' } },
        { title: { contains: q, mode: 'insensitive' } },
        { deal: { is: { name: { contains: q, mode: 'insensitive' } } } },
      ],
    }
    : null
  const cur = cursorWhere(decoded)
  const parts = [where, search, cur].filter(Boolean) as Record<string, unknown>[]
  const finalWhere = parts.length > 1 ? { AND: parts } : where

  const [rows, total] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).crmQuote.findMany({
      where: finalWhere,
      // 딜·회사 이름은 조인으로 한 번에 가져온다 — 목록에서 견적마다 따로 읽으면 N+1 이다
      select: { ...SELECT, deal: { select: { name: true, company: { select: { name: true } } } } },
      orderBy: CURSOR_ORDER,
      take: limit + 1,
    }),
    // 총 건수는 커서만 빼고 **같은 조건**으로 센다 — 검색을 빼먹으면 화면이 "3건 중 1건"처럼 어긋난다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    countIfFirstPage((db as any).crmQuote, search ? { AND: [where, search] } : where, decoded),
  ]) as [(QuoteRow & { deal: { name: string; company: { name: string } | null } | null })[], number | undefined]

  const items = rows.map((r) => {
    const { deal, ...rest } = r
    return {
      ...rest,
      expired: markExpired(r, now),
      dealName: deal?.name ?? '(딜 없음)',
      companyName: deal?.company?.name ?? null,
    }
  })
  return toPage(items, limit, total)
}

export async function getQuote(db: CrmDb, id: string): Promise<QuoteRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (db as any).crmQuote.findFirst({ where: { id }, select: SELECT })
  if (!row) throw new CrmError('NOT_FOUND', '견적을 찾을 수 없습니다.')

  // 항목은 부모(견적)를 확인한 뒤에만 읽는다 — 항목만 새어 나가면 안 된다(DI-01)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lines = await (db as any).crmQuoteLine.findMany({
    where: { quoteId: id }, select: LINE_SELECT, orderBy: { position: 'asc' },
  })

  return { ...(row as QuoteRow), lines: lines as QuoteLineRow[], expired: markExpired(row, new Date()) }
}

// ------------------------------------------------------------
// 번호
// ------------------------------------------------------------

/**
 * 다음 견적 번호.
 *
 * **왜 max+1 을 쓰나**: 시퀀스를 따로 두면 견적을 지웠을 때 번호가 비고,
 * 사람은 "3번은 어디 갔지"를 묻는다. 올해 최대 번호 +1 이면 설명이 필요 없다.
 * 동시에 두 사람이 만들면 같은 번호가 나올 수 있는데, 그건 유니크 제약이 잡고
 * 아래에서 한 번 더 시도한다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function nextQuoteNo(tx: any, year: number): Promise<string> {
  const last = await tx.crmQuote.findFirst({
    where: {
      quoteNo: { startsWith: `Q-${year}-` },
      // 삭제된 것도 번호는 이미 쓴 것이다 — 재사용하면 감사 로그의 한 번호가 두 문서를 가리킨다.
      // 키를 명시하면 가드가 기본 필터(deletedAt: null)를 넣지 않는다(workspace-guard 참조).
      deletedAt: undefined,
    },
    orderBy: { quoteNo: 'desc' },
    select: { quoteNo: true },
  })
  return formatQuoteNo(year, seqOfQuoteNo(last?.quoteNo, year) + 1)
}

// ------------------------------------------------------------
// 생성 · 수정
// ------------------------------------------------------------

export interface CreateQuoteInput {
  /** 고른 거래 조건. 순서가 곧 인쇄 순서다 */
  termIds?: string[]
  dealId: string
  title?: string | null
  currency?: string | null
  validUntil?: string | null
  notesMd?: string | null
  ownerId?: string | null
  /** 공급받는 곳의 담당자. 안 고르면 null — 회사 앞으로만 나간다 */
  recipientPersonId?: string | null
  lines?: QuoteLineData[]
}

export async function createQuote(
  workspaceId: string,
  actorId: string | null,
  input: CreateQuoteInput,
): Promise<QuoteRow> {
  rejectUnknownKeys(input, QUOTE_KEYS, '견적')
  if (!input.dealId) {
    throw new CrmError('VALIDATION_FAILED', '견적을 붙일 딜을 선택해 주세요.', { field: 'dealId' })
  }

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deal = await (tx as any).crmDeal.findFirst({
      where: { id: input.dealId }, select: { id: true, name: true, currency: true },
    })
    if (!deal) throw new CrmError('NOT_FOUND', '딜을 찾을 수 없습니다.')

    // 통화는 딜을 따른다 — 견적과 딜의 통화가 다르면 파이프라인 합계가 섞인다
    const currency = (normalizeText(input.currency) ?? deal.currency ?? 'KRW').toUpperCase()
    const title = requireText(input.title) ?? `${deal.name} 견적`

    const lines = (input.lines ?? []).map((l, i) => toLineData(l, i))
    const totals = computeTotals(lines as unknown as QuoteLineInput[])
    const threshold = await approvalThreshold(tx)

    const year = new Date().getFullYear()
    let quoteNo = await nextQuoteNo(tx, year)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let created: any
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      created = await (tx as any).crmQuote.create({
        data: {
          dealId: input.dealId,
          quoteNo,
          title,
          currency,
          validUntil: input.validUntil ? new Date(input.validUntil) : null,
          notesMd: normalizeText(input.notesMd),
          // 고른 조건. 순서를 그대로 저장한다 — 그 순서가 인쇄 순서다
          termIds: Array.isArray(input.termIds) ? input.termIds.filter((v) => typeof v === 'string') : [],
          ownerId: input.ownerId || null,
          createdById: actorId,
          subtotalMinor: totals.subtotalMinor,
          discountMinor: totals.discountMinor,
          taxMinor: totals.taxMinor,
          totalMinor: totals.totalMinor,
          approvalRequired: needsApproval(totals, threshold),
          ...(lines.length > 0 ? { lines: { create: lines } } : {}),
        },
        select: SELECT,
      })
    } catch (e) {
      // 같은 번호를 동시에 집었다 — 한 번만 다시 시도한다.
      // 무한 재시도는 하지 않는다(트랜잭션을 오래 잡으면 다른 요청이 줄을 선다)
      if (!isUniqueViolation(e)) throw e
      quoteNo = await nextQuoteNo(tx, year)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      created = await (tx as any).crmQuote.create({
        data: {
          dealId: input.dealId, quoteNo, title, currency,
          validUntil: input.validUntil ? new Date(input.validUntil) : null,
          notesMd: normalizeText(input.notesMd), ownerId: input.ownerId || null,
          recipientPersonId: input.recipientPersonId || null,
          ...(Array.isArray(input.termIds)
            ? { termIds: input.termIds.filter((v) => typeof v === 'string') }
            : {}),
          createdById: actorId,
          subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor,
          taxMinor: totals.taxMinor, totalMinor: totals.totalMinor,
          approvalRequired: needsApproval(totals, threshold),
          ...(lines.length > 0 ? { lines: { create: lines } } : {}),
        },
        select: SELECT,
      })
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'quote.created',
      targetType: 'quote', targetId: created.id, afterJson: serialize(created),
    })
    return created as QuoteRow
  })
}

function isUniqueViolation(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && (e as { code?: string }).code === 'P2002')
}

/**
 * 할인 승인 임계(%). 워크스페이스 설정이 있으면 그것이 이긴다.
 *
 * 설정이 없어도 돌아야 한다 — 그래서 실패는 조용히 기본값으로 떨어진다.
 * 여기서 던지면 설정 하나 없다고 견적을 못 만든다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function approvalThreshold(tx: any): Promise<number> {
  try {
    const row = await tx.crmAppSetting.findFirst({
      where: { key: 'quote.discountApprovalPct' },
      orderBy: { workspaceId: 'desc' }, // 워크스페이스 값이 GLOBAL(null)을 이긴다
      select: { valueJson: true },
    })
    const raw = row?.valueJson
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n
  } catch {
    // 설정을 못 읽는 것이 견적을 막을 이유는 없다
  }
  return DEFAULT_DISCOUNT_APPROVAL_PCT
}

export interface UpdateQuoteInput {
  termIds?: string[]
  version: number
  title?: string | null
  validUntil?: string | null
  notesMd?: string | null
  ownerId?: string | null
  recipientPersonId?: string | null
  /**
   * 항목 전체. 주면 통째로 맞춘다(있는 것은 고치고, 없어진 것은 지우고, 새 것은 만든다).
   * 안 주면 항목은 손대지 않는다 — 제목만 고칠 때 항목이 날아가면 안 된다.
   */
  lines?: QuoteLineData[]
}

/**
 * 견적 수정.
 *
 * **초안일 때만 항목·금액을 고칠 수 있다.** 보낸 견적을 고치면 고객이 든 문서와 달라진다.
 * 제목·메모·담당자는 보낸 뒤에도 고칠 수 있다 — 그건 우리 쪽 정리용 정보다.
 */
export async function updateQuote(
  workspaceId: string,
  actorId: string | null,
  id: string,
  input: UpdateQuoteInput,
): Promise<QuoteRow> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmQuote.findFirst({ where: { id }, select: SELECT })
    if (!before) throw new CrmError('NOT_FOUND', '견적을 찾을 수 없습니다.')

    const editingLines = input.lines !== undefined
    if (editingLines && before.status !== 'DRAFT') {
      throw new CrmError('VALIDATION_FAILED',
        '이미 보낸 견적의 항목은 고칠 수 없습니다. 새 견적을 만들어 주세요.',
        { field: 'lines', status: before.status })
    }

    const data: Record<string, unknown> = { ...BUMP_VERSION }
    if (input.title !== undefined) {
      const title = requireText(input.title)
      if (!title) throw new CrmError('VALIDATION_FAILED', '견적 제목을 입력해 주세요.', { field: 'title' })
      data.title = title
    }
    if (input.validUntil !== undefined) {
      data.validUntil = input.validUntil ? new Date(input.validUntil) : null
    }
    if (input.notesMd !== undefined) data.notesMd = normalizeText(input.notesMd)
    // 빈 문자열은 «고르지 않음»이다 — null 로 눕혀야 FK 가 받는다
    if (input.recipientPersonId !== undefined) data.recipientPersonId = input.recipientPersonId || null
    if (input.ownerId !== undefined) data.ownerId = input.ownerId || null

    // 한 번만 계산한다 — 두 번 계산하면 그 사이 규칙이 갈릴 자리가 생긴다
    const nextLines = editingLines ? (input.lines ?? []).map((l, i) => toLineData(l, i)) : null
    const nextIds = editingLines ? (input.lines ?? []).map((l) => l.id ?? null) : null

    if (editingLines && nextLines) {
      const totals = computeTotals(nextLines as unknown as QuoteLineInput[])
      const threshold = await approvalThreshold(tx)

      data.subtotalMinor = totals.subtotalMinor
      data.discountMinor = totals.discountMinor
      data.taxMinor = totals.taxMinor
      data.totalMinor = totals.totalMinor

      const required = needsApproval(totals, threshold)
      data.approvalRequired = required
      // 금액이 바뀌면 앞선 승인은 무효다 — 승인받은 금액과 보낼 금액이 달라진다
      if (required && amountsChanged(before, totals)) {
        data.approvedAt = null
        data.approvedById = null
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmQuote.updateMany({
      where: lockWhere(id, input.version), data,
    })
    assertUpdated(res.count, { exists: true, version: before.version }, '견적')

    if (nextLines && nextIds) {
      await syncLines(tx, id, nextLines, nextIds)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = await (tx as any).crmQuote.findFirst({ where: { id }, select: SELECT })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'quote.updated', targetType: 'quote', targetId: id,
      beforeJson: serialize(before), afterJson: serialize(after),
    })
    return after as QuoteRow
  })
}

function amountsChanged(
  before: { subtotalMinor: bigint; discountMinor: bigint; totalMinor: bigint },
  totals: { subtotalMinor: bigint; discountMinor: bigint; totalMinor: bigint },
): boolean {
  return before.subtotalMinor !== totals.subtotalMinor
    || before.discountMinor !== totals.discountMinor
    || before.totalMinor !== totals.totalMinor
}

/**
 * 항목을 입력과 맞춘다.
 *
 * **왜 전부 지우고 다시 넣지 않나**: 주간보고에서 그렇게 하다 데이터를 잃은 적이 있다
 * (v0.7.287 파괴적 DELETE+INSERT). id 를 보존하면 감사 로그·참조가 살아 있고,
 * 실수로 빈 배열이 와도 지워지는 것은 "이번에 안 온 항목"뿐이라 원인이 분명하다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncLines(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  quoteId: string,
  lines: Record<string, unknown>[],
  ids: (string | null)[],
): Promise<void> {
  const existing: { id: string }[] = await tx.crmQuoteLine.findMany({
    where: { quoteId }, select: { id: true },
  })
  const keep = new Set(ids.filter((v): v is string => Boolean(v)))

  const gone = existing.filter((e) => !keep.has(e.id)).map((e) => e.id)
  if (gone.length > 0) {
    await tx.crmQuoteLine.deleteMany({ where: { quoteId, id: { in: gone } } })
  }

  for (let i = 0; i < lines.length; i++) {
    const id = ids[i]
    if (id && existing.some((e) => e.id === id)) {
      await tx.crmQuoteLine.updateMany({ where: { id, quoteId }, data: lines[i] })
    } else {
      await tx.crmQuoteLine.create({ data: { ...lines[i], quoteId } })
    }
  }
}

// ------------------------------------------------------------
// 승인 · 발송 · 결정
// ------------------------------------------------------------

/**
 * 할인 승인.
 *
 * 지금은 **누구나 승인할 수 있다** — 승인 권한 체계가 아직 없다.
 * 그래도 누가 언제 승인했는지는 남는다. 없는 권한을 있는 척하지 않고,
 * 나중에 권한이 생기면 여기 한 곳만 막으면 된다.
 */
export async function approveQuote(
  workspaceId: string,
  actorId: string | null,
  id: string,
  version: number,
): Promise<QuoteRow> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmQuote.findFirst({ where: { id }, select: SELECT })
    if (!before) throw new CrmError('NOT_FOUND', '견적을 찾을 수 없습니다.')
    if (!before.approvalRequired) {
      throw new CrmError('VALIDATION_FAILED', '이 견적은 승인이 필요하지 않습니다.')
    }
    if (before.approvedAt) return before as QuoteRow // 이미 승인됐다 — 두 번 눌러도 같은 결과

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmQuote.updateMany({
      where: lockWhere(id, version),
      data: { approvedAt: new Date(), approvedById: actorId, ...BUMP_VERSION },
    })
    assertUpdated(res.count, { exists: true, version: before.version }, '견적')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = await (tx as any).crmQuote.findFirst({ where: { id }, select: SELECT })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'quote.approved', targetType: 'quote', targetId: id,
      afterJson: { approvedAt: after.approvedAt, discountRate: discountRateOf(after) },
    })
    return after as QuoteRow
  })
}

export interface TransitQuoteInput {
  version: number
  to: QuoteStatus
  /** ACCEPTED 일 때 딜 금액을 이 견적 총액으로 맞출지 */
  syncDealAmount?: boolean
}

/**
 * 상태 전이 — 보내기·수락·거절·만료·초안 복귀가 전부 여기를 지난다.
 *
 * **왜 하나로 묶었나**: 전이마다 함수를 따로 두면 어느 하나가 canTransitQuote 를
 * 안 부르는 날이 온다. 입구가 하나면 그럴 수 없다.
 */
export async function transitQuote(
  workspaceId: string,
  actorId: string | null,
  id: string,
  input: TransitQuoteInput,
): Promise<QuoteRow> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmQuote.findFirst({ where: { id }, select: SELECT })
    if (!before) throw new CrmError('NOT_FOUND', '견적을 찾을 수 없습니다.')

    const lineCount = await tx.crmQuoteLine.count({ where: { quoteId: id } })

    // 판정을 먼저 한다 — 통과 못 하면 아무것도 쓰지 않는다
    assertTransit('quote', before.status as QuoteStatus, input.to, {
      lineCount,
      approvalRequired: before.approvalRequired,
      approvedAt: before.approvedAt,
      validUntil: before.validUntil,
    })

    const now = new Date()
    const data: Record<string, unknown> = { status: input.to, ...BUMP_VERSION }
    if (input.to === 'SENT') data.sentAt = now
    if (input.to === 'ACCEPTED' || input.to === 'REJECTED') data.decidedAt = now
    if (input.to === 'DRAFT') {
      // 초안으로 되돌리면 발송·결정 흔적을 지운다 — 남겨 두면 "보냈는데 초안"이 된다
      data.sentAt = null
      data.decidedAt = null
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmQuote.updateMany({ where: lockWhere(id, input.version), data })
    assertUpdated(res.count, { exists: true, version: before.version }, '견적')

    // 수락된 견적의 총액이 곧 딜 금액이다 — 사람이 옮겨 적게 하면 언젠가 안 옮긴다.
    // 단, 딜에 이미 금액이 있으면 덮지 않는다(사용자가 협상 결과를 손으로 넣었을 수 있다).
    let dealSynced = false
    if (input.to === 'ACCEPTED' && input.syncDealAmount !== false) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deal = await (tx as any).crmDeal.findFirst({
        where: { id: before.dealId }, select: { id: true, amountMinor: true, version: true },
      })
      if (deal && (deal.amountMinor === null || input.syncDealAmount === true)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx as any).crmDeal.updateMany({
          where: { id: deal.id },
          data: { amountMinor: before.totalMinor, currency: before.currency, ...BUMP_VERSION },
        })
        dealSynced = true
        await writeAudit(tx, {
          actorType: 'SYSTEM', actorId, action: 'deal.amount_from_quote',
          targetType: 'deal', targetId: deal.id,
          beforeJson: { amountMinor: deal.amountMinor?.toString() ?? null },
          afterJson: { amountMinor: before.totalMinor.toString(), quoteNo: before.quoteNo },
        })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = await (tx as any).crmQuote.findFirst({ where: { id }, select: SELECT })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: `quote.${input.to.toLowerCase()}`,
      targetType: 'quote', targetId: id,
      beforeJson: { status: before.status },
      afterJson: { status: input.to, dealSynced },
    })
    return after as QuoteRow
  })
}

// ------------------------------------------------------------
// 삭제 · 복구
// ------------------------------------------------------------

export async function deleteQuote(
  workspaceId: string,
  actorId: string | null,
  id: string,
  mode: DeleteMode = 'trash',
): Promise<void> {
  const plan = planDelete(mode)

  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmQuote.findFirst({
      where: mode === 'purge' ? { id, deletedAt: { not: undefined } } : { id }, select: SELECT,
    })
    if (!before) throw new CrmError('NOT_FOUND', '견적을 찾을 수 없습니다.')

    if (mode === 'trash') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (tx as any).crmQuote.updateMany({
        where: { id }, data: { deletedAt: new Date(), ...BUMP_VERSION },
      })
      assertUpdated(res.count, { exists: true, version: before.version }, '견적')
    } else {
      // 항목은 FK CASCADE 로 함께 사라진다
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmQuote.deleteMany({ where: { id } })
    }

    await writeAudit(tx, {
      // 삭제는 도메인이 아니라 공통 action 으로 남는다 — 대상 종류는 targetType 이 말한다
      actorType: 'HUMAN', actorId, action: plan.auditAction,
      targetType: 'quote', targetId: id, beforeJson: serialize(before),
    })
  })
}

export async function restoreQuote(
  workspaceId: string,
  actorId: string | null,
  id: string,
): Promise<QuoteRow> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmQuote.updateMany({
      where: { id, deletedAt: { not: null } },
      data: { deletedAt: null, ...BUMP_VERSION },
    })
    if (res.count === 0) throw new CrmError('NOT_FOUND', '휴지통에서 견적을 찾을 수 없습니다.')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = await (tx as any).crmQuote.findFirst({ where: { id }, select: SELECT })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'quote.restored',
      targetType: 'quote', targetId: id, afterJson: serialize(after),
    })
    return after as QuoteRow
  })
}

// ------------------------------------------------------------
// 직렬화
// ------------------------------------------------------------

/** BigInt·Decimal 은 JSON 으로 직렬화되지 않는다 */
function serialize(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'bigint' ? v.toString() : v
  }
  return out
}

/**
 * 화면으로 나가는 모양.
 * BigInt 를 문자열로 바꾸지 않으면 JSON.stringify 가 그 자리에서 던진다 —
 * 200 을 기대한 화면이 500 을 받고, 원인은 응답 본문에 안 나온다.
 */
export function toQuoteJson(row: QuoteRow): Record<string, unknown> {
  return {
    ...row,
    subtotalMinor: row.subtotalMinor.toString(),
    discountMinor: row.discountMinor.toString(),
    taxMinor: row.taxMinor.toString(),
    totalMinor: row.totalMinor.toString(),
    discountRate: Number(discountRateOf(row).toFixed(2)),
    lines: row.lines?.map((l) => ({
      ...l,
      unitPriceMinor: l.unitPriceMinor.toString(),
      lineTotalMinor: l.lineTotalMinor.toString(),
      quantity: String(l.quantity),
      discountPercent: String(l.discountPercent),
      taxRate: String(l.taxRate),
    })),
  }
}
