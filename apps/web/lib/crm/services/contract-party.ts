/**
 * 계약 당사자 — 둘이 아니라 N명이다 (P0184 I03)
 *
 * 매출 매입은 둘이지만 공동수급은 주관사와 구성원 여럿, 3자 계약은 중개인이 끼고, 제휴는 대등한 둘이다.
 * 「공급자 고객」 두 칸으로는 그 모양을 못 담아서 당사자를 행으로 둔다.
 *
 * **글자는 스냅샷이 든다.** 회사 행은 가리킬 뿐이다 — 회사 이름이 바뀌어도 체결한 계약서의
 * 상호는 그날 것이어야 한다. 회사를 지우면 가리킴만 비고 스냅샷은 남는다(마이그 325).
 */

import { CrmError } from '../domain/errors.ts'
import { normalizeText } from '../domain/normalize.ts'
import type { QuoteDocument } from '../domain/quote-document.ts'
import { CONTRACT_PARTY_MSG } from '../../terms/contract-doc.ts'

export const PARTY_ROLES = ['SUPPLIER', 'CUSTOMER', 'LEAD', 'MEMBER', 'BROKER', 'PARTNER', 'OTHER'] as const
export type PartyRole = (typeof PARTY_ROLES)[number]

/** 공동수급 스무 곳을 넘는 계약은 없다 — 넘으면 입력이 잘못 들어온 것이다 */
export const MAX_PARTIES = 20
const MAX_NAME = 200
const MAX_VALUE = 500

const SNAPSHOT_KEYS = ['name', 'ceo', 'bizNo', 'address', 'phone'] as const
export type PartySnapshot = { name: string } & Partial<Record<Exclude<(typeof SNAPSHOT_KEYS)[number], 'name'>, string>>

export interface PartyInput {
  role: PartyRole
  isSelf: boolean
  companyId: string | null
  snapshot: PartySnapshot
}

const invalid = (message: string, field = 'parties') => new CrmError('VALIDATION_FAILED', message, { field })

function checkSnapshot(raw: unknown, n: number): PartySnapshot {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out: Record<string, string> = {}
  for (const k of SNAPSHOT_KEYS) {
    const v = s[k]
    if (v === undefined || v === null) continue
    if (typeof v !== 'string') throw invalid(CONTRACT_PARTY_MSG.badShape(n))
    const t = normalizeText(v) ?? ''
    if (t.length > (k === 'name' ? MAX_NAME : MAX_VALUE)) throw invalid(CONTRACT_PARTY_MSG.valueTooLong(n))
    if (t) out[k] = t
  }
  if (!out.name) throw invalid(CONTRACT_PARTY_MSG.nameRequired(n))
  return out as PartySnapshot
}

function checkParty(raw: unknown, n: number): PartyInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid(CONTRACT_PARTY_MSG.badShape(n))
  const p = raw as Record<string, unknown>
  if (!PARTY_ROLES.includes(p.role as PartyRole)) throw invalid(CONTRACT_PARTY_MSG.badRole(n))
  if (p.isSelf !== undefined && typeof p.isSelf !== 'boolean') throw invalid(CONTRACT_PARTY_MSG.badShape(n))
  if (p.companyId !== undefined && p.companyId !== null && (typeof p.companyId !== 'string' || !p.companyId)) {
    throw invalid(CONTRACT_PARTY_MSG.badShape(n))
  }
  return {
    role: p.role as PartyRole,
    isSelf: p.isSelf === true,
    companyId: typeof p.companyId === 'string' ? p.companyId : null,
    snapshot: checkSnapshot(p.snapshot, n),
  }
}

/** 밖에서 온 당사자 목록을 검사한다. 순서가 곧 계약서에 적히는 순서다 */
export function checkParties(input: unknown, direction: string): PartyInput[] {
  if (!Array.isArray(input) || input.length === 0) throw invalid(CONTRACT_PARTY_MSG.required)
  if (input.length > MAX_PARTIES) throw invalid(CONTRACT_PARTY_MSG.tooMany(MAX_PARTIES))
  const parties = input.map((p, i) => checkParty(p, i + 1))
  if (parties.filter((p) => p.isSelf).length > 1) throw invalid(CONTRACT_PARTY_MSG.selfOnce)
  if (direction === 'CONSORTIUM' && parties.filter((p) => p.role === 'LEAD').length !== 1) {
    throw invalid(CONTRACT_PARTY_MSG.consortiumLead)
  }
  return parties
}

/** 견적으로 만든 계약 — 견적서의 공급자(우리)와 고객 둘 */
export function partiesFromQuote(doc: QuoteDocument, customerCompanyId: string | null): PartyInput[] {
  const pick = (o: Record<string, string | null | undefined>): Partial<PartySnapshot> =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'string' && v.trim() !== '')) as Partial<PartySnapshot>
  return [
    {
      role: 'SUPPLIER', isSelf: true, companyId: null,
      snapshot: {
        ...pick({ ceo: doc.supplier.ceo, bizNo: doc.supplier.bizNo, address: doc.supplier.address, phone: doc.supplier.phone }),
        name: doc.supplier.name,
      },
    },
    {
      role: 'CUSTOMER', isSelf: false, companyId: customerCompanyId,
      snapshot: { ...pick({ phone: doc.customer.phone }), name: doc.customer.companyName },
    },
  ]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** 고른 회사가 이 워크스페이스에 있는지 — 가드가 남의 워크스페이스 행을 0건으로 만든다 */
export async function assertPartyCompanies(db: Db, parties: readonly PartyInput[]): Promise<void> {
  const ids = [...new Set(parties.map((p) => p.companyId).filter((x): x is string => x !== null))]
  if (ids.length === 0) return
  const found = await db.crmCompany.count({ where: { id: { in: ids } } })
  if (found !== ids.length) throw invalid(CONTRACT_PARTY_MSG.companyNotFound)
}

/** 트랜잭션 안에서 당사자 행을 쓴다. 계약을 만든 같은 트랜잭션이어야 반쪽 계약이 안 남는다 */
export async function writeParties(tx: Db, workspaceId: string, contractId: string, parties: readonly PartyInput[]): Promise<void> {
  await tx.crmContractParty.createMany({
    data: parties.map((p, i) => ({
      workspaceId, contractId, role: p.role, isSelf: p.isSelf, position: i, companyId: p.companyId, snapshot: p.snapshot,
    })),
  })
}

/** 견적 칸(공급자 고객)을 당사자에서 채운다 — 딜 없이 만든 계약의 첫 자동 값 */
export function autoValuesFromParties(parties: readonly PartyInput[], contractNo: string): Record<string, string> {
  const supplying = parties.some((p) => p.role === 'SUPPLIER' || p.role === 'CUSTOMER')
  // 공급 관계가 아니면(제휴 공동수급 회사 단위) 우리가 고객 칸(갑), 첫 상대가 공급자 칸(을) — contract-fields 갑 을
  const supplier = (supplying ? parties.find((p) => p.role === 'SUPPLIER') : parties.find((p) => !p.isSelf))?.snapshot
  const customer = (supplying ? parties.find((p) => p.role === 'CUSTOMER') : parties.find((p) => p.isSelf))?.snapshot
  return {
    'supplier.name': supplier?.name ?? '',
    'supplier.ceo': supplier?.ceo ?? '',
    'supplier.bizNo': supplier?.bizNo ?? '',
    'supplier.address': supplier?.address ?? '',
    'supplier.phone': supplier?.phone ?? '',
    'customer.name': customer?.name ?? '',
    'customer.ceo': customer?.ceo ?? '',
    'customer.bizNo': customer?.bizNo ?? '',
    'customer.address': customer?.address ?? '',
    'customer.phone': customer?.phone ?? '',
    'contract.no': contractNo,
  }
}

export interface PartyRow extends PartyInput { id: string; position: number }

/** 계약의 당사자 — 순서대로. 계약을 먼저 읽은 창구만 부른다 (등급 거름망은 계약 행에 걸려 있다) */
export async function listParties(db: Db, contractId: string): Promise<PartyRow[]> {
  return db.crmContractParty.findMany({
    where: { contractId }, orderBy: { position: 'asc' },
    select: { id: true, role: true, isSelf: true, position: true, companyId: true, snapshot: true },
  })
}

/** 당사자를 통째로 바꾼다 — 같은 트랜잭션에서 지우고 다시 쓴다 */
export async function replaceParties(tx: Db, workspaceId: string, contractId: string, parties: readonly PartyInput[]): Promise<void> {
  await tx.crmContractParty.deleteMany({ where: { contractId } })
  await writeParties(tx, workspaceId, contractId, parties)
}
