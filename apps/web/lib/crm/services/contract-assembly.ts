/**
 * 계약에 모듈을 골라 본문을 조립하는 자리 (P0184 I12)
 *
 * 판정(어떤 모듈이 들어가나)은 domain/contract-module.ts 의 selectModules, 조립은
 * domain/contract-assemble.ts 가 한다. 여기는 재료(계약 사실, 활성 모듈, 라이브러리 승인본)를 모아
 * 넘기고, 결과를 다음 버전으로 저장한다.
 *
 * **미리 보기와 저장이 같은 길이다.** dryRun 이면 저장만 빼고 같은 판정을 돌려준다. 화면이 따로
 * 판정하면 미리 본 것과 저장된 것이 갈린다.
 *
 * **승인본을 먼저 쓰고, 없으면 초안을 쓴다.** 초안 조항은 표준이 아니라 이탈로 잡혀 승인 전에는
 * 체결되지 않는다. 라이브러리에 아예 없는 키가 하나라도 있으면 저장하지 않고 그 키를 말한다.
 */

import type { CrmDb } from '../db/client.ts'
import { CrmError } from '../domain/errors.ts'
import { assembleContract, type ClauseText } from '../domain/contract-assemble.ts'
import type { Clause } from '../domain/contract-body.ts'
import {
  conditionHolds, isModuleKind, selectModules, type ContractModule, type ModuleCondition, type ModuleContext,
} from '../domain/contract-module.ts'
import type { FieldValues } from '../domain/contract-fields.ts'
import { findContract, getContractVersion, saveContractVersion, type ContractRow } from './contract.ts'
import { CONTRACT_ASSEMBLY_MSG, CONTRACT_MODULE_MSG } from '../../terms/contract-doc.ts'

const KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/
export const MAX_CHOSEN_MODULES = 50

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const any = (db: unknown): any => db

export interface AssemblyInput {
  moduleKeys?: unknown
  dryRun?: unknown
}

export interface AssemblyPlan {
  /** 들어가는 모듈 키 (공통 + 고른 것 + 조건이 맞는 것), 조립 순서 아님 */
  modules: string[]
  /** 조건이 맞아 저절로 들어간 모듈 (골랐어도 여기에 든다) */
  automatic: string[]
  /** 라이브러리에 아예 없는 조항 키 — 하나라도 있으면 저장하지 않는다 */
  missing: string[]
  /** 승인본이 없어 초안 글로 들어간 조항 키 — 관리자 승인 전에는 체결되지 않는다 */
  drafts: string[]
  clauseCount: number
}

export interface AssemblyResult extends AssemblyPlan {
  saved: { contract: ContractRow; versionNo: number; created: boolean } | null
}

function pickModuleKeys(v: unknown): string[] {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > MAX_CHOSEN_MODULES || v.some((k) => typeof k !== 'string' || !KEY_PATTERN.test(k))) {
    throw new CrmError('VALIDATION_FAILED', CONTRACT_ASSEMBLY_MSG.badModuleKeys, { field: 'moduleKeys' })
  }
  return [...new Set(v as string[])]
}

/** DB 의 enableWhen 은 저장 때 검사를 지났다. 모양이 아니면 「조건 없음」으로 읽는다 */
function readCondition(raw: unknown): ModuleCondition | null {
  const all = (raw as { all?: unknown } | null)?.all
  return Array.isArray(all) ? { all } as ModuleCondition : null
}

async function activeModules(db: unknown): Promise<ContractModule[]> {
  const rows: { key: string; kind: string; title: string; clauseKeys: string[]; enableWhen: unknown; position: number }[] =
    await any(db).crmContractModule.findMany({
      where: { isActive: true },
      orderBy: [{ position: 'asc' }, { key: 'asc' }],
      select: { key: true, kind: true, title: true, clauseKeys: true, enableWhen: true, position: true },
    })
  return rows.filter((r) => isModuleKind(r.kind)).map((r) => ({
    key: r.key, kind: r.kind as ContractModule['kind'], title: r.title, clauseKeys: r.clauseKeys,
    enableWhen: readCondition(r.enableWhen), position: r.position,
  }))
}

/**
 * 조항 키마다 쓸 글 (한국어). 승인본이 있으면 가장 최근 승인본, 없으면 가장 최근 초안.
 * 초안 글로 조립한 조항은 표준이 아니라서 표준 이탈(표준에 없는 조항)로 잡히고,
 * 관리자가 그 버전을 승인하기 전에는 체결되지 않는다 (contract-deviation.ts, I08 관문).
 * 공통 조항이 초안뿐이라고 계약서를 아예 못 만들게 두지 않는다 (P0184 I13a)
 */
async function clauseTexts(db: unknown, keys: readonly string[]): Promise<{ texts: Map<string, ClauseText>; drafts: Set<string> }> {
  const rows: { key: string; title: string; html: string; status: string }[] = await any(db).crmContractClause.findMany({
    where: { lang: 'ko', key: { in: [...keys] } },
    orderBy: [{ key: 'asc' }, { versionNo: 'desc' }],
    select: { key: true, title: true, html: true, status: true },
  })
  const texts = new Map<string, ClauseText>()
  const drafts = new Set<string>()
  for (const r of rows) {
    if (r.status === 'APPROVED' && (!texts.has(r.key) || drafts.has(r.key))) {
      texts.set(r.key, { title: r.title, html: r.html })
      drafts.delete(r.key)
    } else if (!texts.has(r.key)) {
      texts.set(r.key, { title: r.title, html: r.html })
      drafts.add(r.key)
    }
  }
  return { texts, drafts }
}

async function contextOf(db: unknown, contract: ContractRow, values: FieldValues): Promise<ModuleContext> {
  const deal = contract.dealId
    ? await any(db).crmDeal.findFirst({ where: { id: contract.dealId }, select: { businessTypeKey: true } })
    : null
  return {
    direction: contract.direction,
    businessTypeKey: deal?.businessTypeKey ?? null,
    values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v?.value ?? ''])),
  }
}

/** 계약 사실과 고른 모듈로 조립 결과를 낸다 — 상세 화면 조립과 템플릿 없이 만들기가 같은 길을 쓴다 */
export async function planAssembly(
  db: unknown, ctx: ModuleContext, chosen: readonly string[],
): Promise<{ selected: ContractModule[]; clauses: Clause[]; missing: string[]; drafts: string[] }> {
  const modules = await activeModules(db)
  const known = new Set(modules.map((m) => m.key))
  const unknown = chosen.filter((k) => !known.has(k))
  if (unknown.length) throw new CrmError('VALIDATION_FAILED', CONTRACT_ASSEMBLY_MSG.unknownModules(unknown.join(', ')), { field: 'moduleKeys' })
  const selected = selectModules(modules, chosen, ctx)
  const { texts, drafts } = await clauseTexts(db, selected.flatMap((m) => m.clauseKeys))
  const { clauses, missing } = assembleContract(selected, texts)
  return { selected, clauses, missing, drafts: [...drafts] }
}

export async function assembleContractModules(
  db: CrmDb, workspaceId: string, actorId: string | null, id: string, version: number, input: AssemblyInput,
): Promise<AssemblyResult> {
  const chosen = pickModuleKeys(input.moduleKeys)
  const contract = await findContract(db, id)
  const current = await getContractVersion(db, id, contract.currentVersionNo)
  const ctx = await contextOf(db, contract, current.fieldValues)
  const { selected, clauses, missing, drafts } = await planAssembly(db, ctx, chosen)
  if (selected.length === 0) throw new CrmError('VALIDATION_FAILED', CONTRACT_ASSEMBLY_MSG.nothingToAssemble)
  const plan: AssemblyPlan = {
    modules: selected.map((m) => m.key),
    // 조건이 정하는 모듈은 골랐든 안 골랐든 저절로 들어간 것이다 — 화면이 그 칸을 잠근다
    automatic: selected.filter((m) => m.kind !== 'COMMON' && conditionHolds(m.enableWhen, ctx)).map((m) => m.key),
    missing,
    drafts,
    clauseCount: clauses.length,
  }
  if (input.dryRun === true) return { ...plan, saved: null }
  if (missing.length) {
    throw new CrmError('VALIDATION_FAILED', CONTRACT_MODULE_MSG.missingClauses(missing.join(', ')), { missing })
  }
  if (clauses.length === 0) throw new CrmError('VALIDATION_FAILED', CONTRACT_ASSEMBLY_MSG.nothingToAssemble)

  const saved = await saveContractVersion(workspaceId, actorId, id, version, {
    body: clauses, note: CONTRACT_ASSEMBLY_MSG.versionNote(selected.map((m) => m.title).join(', ')),
  })
  return { ...plan, saved }
}
