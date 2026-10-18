// 계약서 화면이 부르는 창구와 받는 모양 (P0132 I12a)
//
// 화면은 기존 창구만 부른다 — /api/crm/contracts/[id] 와 그 아래 다섯, 딜 첨부 목록.
// 모양은 서비스(lib/crm/services/contract*.ts)의 반환형을 JSON 으로 옮긴 것이다.
// Date 는 문자열로, BigInt 는 서비스가 이미 문자열로 바꿔 준다.

import type { Clause, ClauseDiff } from '@/lib/crm/domain/contract-body'
import type { FieldValues } from '@/lib/crm/domain/contract-fields'
import type { PatchVerdict } from '@/lib/crm/domain/contract-patch'
import type { ContractAction } from '@/lib/crm/domain/contract-status'
import { readResponse, readApiErrorCode, describeFetchFailure } from '@/lib/crm/api/read-error'
import { CONTRACT_DOC } from '@/lib/terms/contract-doc'

export interface ContractJson {
  id: string
  dealId: string
  quoteId: string | null
  contractNo: string
  title: string
  status: string
  parentContractId: string | null
  currentVersionNo: number
  sentAt: string | null
  sentVersionNo: number | null
  concludedAt: string | null
  version: number
}

export interface ContractVersionJson {
  versionNo: number
  kind: string
  body: Clause[]
  fieldValues: FieldValues
  note: string | null
  createdAt: string
}

export interface QuoteChangeJson {
  state: 'same' | 'changed' | 'gone' | 'none'
  sourceQuoteVersion: number | null
  quoteVersion: number | null
  changed: string[]
  kept: string[]
}

export interface ContractDetail {
  contract: ContractJson
  current: ContractVersionJson
  rendered: Clause[]
  quoteChange: QuoteChangeJson
}

export type ContractVersionItem = Pick<ContractVersionJson, 'versionNo' | 'kind' | 'note' | 'createdAt'>

export interface ContractCompareJson {
  a: number
  b: number
  clauses: ClauseDiff[]
  fields: { key: string; before: string; after: string; source: string }[]
}

export interface ContractEditProposalJson {
  version: number
  versionNo: number
  instruction: string
  pieces: PatchVerdict[]
}

export interface SignedFile { id: string; fileName: string; kind: string }

export interface SaveResult {
  contract: ContractJson
  versionNo: number
  created: boolean
}

/** 창구 하나의 답 — 성공이면 body, 아니면 사람이 읽을 말과 코드 */
export type Outcome<T> =
  | { ok: true; body: T }
  | { ok: false; status: number; code: string | null; message: string }

export async function callApi<T>(url: string, fallback: string, init?: RequestInit): Promise<Outcome<T>> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    return { ok: false, status: 0, code: null, message: describeFetchFailure(CONTRACT_DOC.entity) }
  }
  const out = await readResponse(res, fallback)
  if (out.ok) return { ok: true, body: out.body as T }
  return { ok: false, status: out.status, code: readApiErrorCode(out.body), message: out.message ?? fallback }
}

const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

export const contractUrl = (id: string): string => `/api/crm/contracts/${id}`

export const contractApi = {
  get: (id: string, fail: string) => callApi<ContractDetail>(contractUrl(id), fail),
  save: (id: string, fail: string, body: { version: number; body?: Clause[]; manual?: Record<string, string>; title?: string; note?: string }) =>
    callApi<SaveResult>(contractUrl(id), fail, json('PATCH', body)),
  refill: (id: string, fail: string, version: number) =>
    callApi<SaveResult & { changed: string[]; kept: string[] }>(contractUrl(id), fail, json('PATCH', { version, refill: true })),
  propose: (id: string, fail: string, instruction: string) =>
    callApi<ContractEditProposalJson>(`${contractUrl(id)}/ai-edit`, fail, json('POST', { instruction })),
  applyAi: (id: string, fail: string, body: { version: number; instruction: string; pieces: Pick<PatchVerdict, 'clause' | 'before' | 'after'>[] }) =>
    callApi<SaveResult>(`${contractUrl(id)}/ai-edit`, fail, json('PATCH', body)),
  act: (id: string, fail: string, body: { action: ContractAction; version: number; signedAttachmentId?: string }) =>
    callApi<ContractJson>(`${contractUrl(id)}/status`, fail, json('POST', body)),
  amend: (id: string, fail: string) =>
    callApi<{ contract: ContractJson; versionNo: number }>(`${contractUrl(id)}/status`, fail, json('POST', { action: 'amend' })),
  versions: (id: string, fail: string) => callApi<{ items: ContractVersionItem[] }>(`${contractUrl(id)}/versions`, fail),
  compare: (id: string, fail: string, a: number, b: number) =>
    callApi<ContractCompareJson>(`${contractUrl(id)}/compare?a=${a}&b=${b}`, fail),
  /** 서명본 후보 — 딜 첨부 중 계약서 종류. 서버도 같은 조건으로 다시 본다(contract-sign.ts) */
  signedFiles: async (dealId: string, fail: string): Promise<Outcome<SignedFile[]>> => {
    const out = await callApi<{ items: SignedFile[] }>(`/api/crm/attachments?target=DEAL&targetId=${encodeURIComponent(dealId)}`, fail)
    return out.ok ? { ok: true, body: out.body.items.filter((f) => f.kind === 'CONTRACT') } : out
  },
  exportUrl: (id: string, format: 'pdf' | 'docx' | 'html', versionNo: number) =>
    `${contractUrl(id)}/export?format=${format}&version=${versionNo}`,
}

/** 미리보기 HTML 은 JSON 이 아니라 글이다 — 실패하면 봉투에서 이유를 꺼낸다 */
export async function fetchPaperHtml(url: string, fail: string): Promise<Outcome<string>> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    return { ok: false, status: 0, code: null, message: describeFetchFailure(CONTRACT_DOC.entity) }
  }
  if (res.ok) return { ok: true, body: await res.text() }
  const out = await readResponse(res, fail)
  return { ok: false, status: out.status, code: readApiErrorCode(out.body), message: out.message ?? fail }
}
