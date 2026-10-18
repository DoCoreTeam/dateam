/**
 * 계약서 AI 로 고치기 (P0132 I09)
 *
 * 두 걸음이다.
 *   1 제안: 지시를 받아 AI 가 조각을 내고 코드가 조각마다 판정한다. **아무것도 저장하지 않는다**
 *   2 반영: 사람이 받은 조각만 서버가 지금 본문에 다시 대 보고 다음 버전으로 남긴다.
 *          버전 기록의 메모에 지시 문장이 남는다
 *
 * 화면이 보낸 조각을 믿지 않는다 — 반영 때 서버가 지금 본문에 다시 대 본다.
 * 그 사이 남이 고쳤으면 version 이 달라 CONFLICT 다.
 *
 * AI 는 runAi 를 지난다(예산, 원장, 개인정보 가림). 본문은 칸 자리를 남긴 채 나가므로
 * 칸 값(상호, 대표자, 주소, 사업자번호)은 글자로 나가지 않는다.
 */

import type { CrmDb } from '../db/client.ts'
import { CrmError } from '../domain/errors.ts'
import { normalizeText } from '../domain/normalize.ts'
import { stripTags, type Clause } from '../domain/contract-body.ts'
import {
  MAX_INSTRUCTION, MAX_PATCHES, PatchApplyError, applyPatches, judgePatches, parseContractEdit,
  type ContractEditDoc, type ContractPatch, type PatchVerdict,
} from '../domain/contract-patch.ts'
import { canWriteVersion } from '../domain/contract-status.ts'
import { runAi, type AiAdapter } from '../ai/runner.ts'
import { CONTRACT_EDIT_V1 } from '../ai/prompts/contract-edit.v1.ts'
import { adapterFromSetting } from './quick-create.ts'
import { getContract, saveContractVersion, type ContractRow } from './contract.ts'
import { CONTRACT_AI, CONTRACT_MSG } from '../../terms/contract-doc.ts'

/** 조항 본문을 줄 단위 글로 — 문단과 줄바꿈이 줄이 된다. 칸 자리는 그대로 남는다 */
export function clauseLines(html: string): string {
  return html
    .split(/<\/p>\s*<p[^>]*>|<br\s*\/?>|<\/li>\s*<li[^>]*>/i)
    .map(stripTags)
    .filter(Boolean)
    .join('\n')
}

/** AI 에 나가는 글 — 본문과 지시뿐이다. 칸 값과 견적 스냅샷은 넣지 않는다 */
export function promptInputOf(body: readonly Clause[], instruction: string): string {
  const doc = body.map((c, i) => `[조항 ${i + 1}] ${c.title}\n${clauseLines(c.html)}`).join('\n\n')
  return `지시\n${instruction}\n\n계약서\n${doc}`
}

export function cleanInstruction(raw: unknown): string {
  const t = normalizeText(typeof raw === 'string' ? raw : null)
  if (!t) throw new CrmError('VALIDATION_FAILED', CONTRACT_AI.instructionRequired, { field: 'instruction' })
  if (t.length > MAX_INSTRUCTION) throw new CrmError('VALIDATION_FAILED', CONTRACT_AI.instructionTooLong, { field: 'instruction' })
  return t
}

function assertWritable(contract: Pick<ContractRow, 'status'>): void {
  if (!canWriteVersion(contract.status)) throw new CrmError('INVALID_TRANSITION', CONTRACT_MSG.notWritable)
}

export interface ContractEditProposal {
  contractId: string
  /** 반영할 때 그대로 돌려보낸다 — 그 사이 남이 고쳤으면 CONFLICT */
  version: number
  versionNo: number
  instruction: string
  pieces: PatchVerdict[]
  runId: string | null
}

/** 조각을 내 주는 쪽 — 운영에서는 runAi, 시험에서는 가짜 */
export type ProposeEdits = (input: string) => Promise<{ edits: ContractPatch[]; runId: string | null }>

/** 제안 — 저장하지 않는다 */
export async function proposeContractEdit(
  db: CrmDb, workspaceId: string, actorId: string | null, id: string, rawInstruction: unknown,
  propose?: ProposeEdits, adapter?: AiAdapter,
): Promise<ContractEditProposal> {
  const instruction = cleanInstruction(rawInstruction)
  const { contract, current } = await getContract(db, id)
  assertWritable(contract)
  const input = promptInputOf(current.body, instruction)
  const ask: ProposeEdits = propose ?? (async (text) => {
    const chosen = adapter ?? await adapterFromSetting(db, { actorId })
    const { output, runId } = await runAi<ContractEditDoc>({
      actorId, db, workspaceId, kind: 'ASSISTANT',
      prompt: CONTRACT_EDIT_V1,
      input: text,
      inputRef: { contractId: id, versionNo: current.versionNo, clauses: current.body.length, instructionChars: instruction.length },
      parse: parseContractEdit,
      adapter: chosen,
    })
    return { edits: output.edits, runId }
  })
  const { edits, runId } = await ask(input)
  return {
    contractId: id, version: contract.version, versionNo: current.versionNo, instruction,
    pieces: judgePatches(current.body, edits), runId,
  }
}

/** 화면이 보낸 받은 조각 — 모양만 보고 판정은 서버가 다시 한다 */
export function checkAcceptedPieces(input: unknown): Pick<ContractPatch, 'clause' | 'before' | 'after'>[] {
  if (!Array.isArray(input) || input.length === 0) throw new CrmError('VALIDATION_FAILED', CONTRACT_AI.noPieces, { field: 'pieces' })
  if (input.length > MAX_PATCHES) throw new CrmError('VALIDATION_FAILED', CONTRACT_AI.tooManyPieces, { field: 'pieces' })
  return input.map((raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    if (!Number.isInteger(p.clause) || typeof p.before !== 'string' || typeof p.after !== 'string') {
      throw new CrmError('VALIDATION_FAILED', CONTRACT_AI.badPiece, { field: 'pieces' })
    }
    return { clause: p.clause as number, before: p.before, after: p.after }
  })
}

export interface ApplyContractEditInput {
  instruction?: unknown
  pieces?: unknown
}

/** 반영 — 사람이 받은 조각만 다음 버전으로. 지시 문장이 버전 메모에 남는다 */
export async function applyContractEdit(
  db: CrmDb, workspaceId: string, actorId: string | null, id: string, version: number, input: ApplyContractEditInput,
): Promise<{ contract: ContractRow; versionNo: number; created: boolean }> {
  const instruction = cleanInstruction(input.instruction)
  const pieces = checkAcceptedPieces(input.pieces)
  const { contract, current } = await getContract(db, id)
  assertWritable(contract)
  if (contract.version !== version) throw new CrmError('CONFLICT', CONTRACT_MSG.conflict)
  let body: Clause[]
  try {
    body = applyPatches(current.body, pieces)
  } catch (e) {
    if (e instanceof PatchApplyError) {
      throw new CrmError('VALIDATION_FAILED', CONTRACT_AI.pieceStale(e.index + 1), { field: 'pieces', reason: e.why })
    }
    throw e
  }
  return saveContractVersion(workspaceId, actorId, id, version, { body, note: instruction }, 'AI_EDIT')
}
