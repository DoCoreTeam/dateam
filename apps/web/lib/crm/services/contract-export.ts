/**
 * 계약서 내보내기 — 버전 하나를 PDF, Word, 미리보기 HTML 로 (P0132 I12)
 *
 * **버전을 고른다.** 번호를 안 주면 지금 버전이다. 보낸 버전과 지금 버전이 다를 수 있으므로
 * 「보낸 그 종이」를 다시 받으려면 번호로 굽는다. 버전은 한 번 쓰면 안 바뀌니 같은 번호는 같은 종이다.
 *
 * **굽는 일은 render-document 한 자리를 지난다.** 서버 크로미움에는 한글 자형이 없어서,
 * 크로미움을 따로 부르면 계약서만 빈칸으로 나간다(headless-font 가드가 막는다).
 * 그 모듈은 server-only 라 여기서는 필요할 때만 읽는다 — 이 파일이 시험에서 열리게.
 */

import { Packer } from 'docx'
import type { CrmDb } from '../db/client.ts'
import { CrmError } from '../domain/errors.ts'
import {
  buildContractDocx, contractFileName, contractPaperHtml, type ContractPaperInput,
} from '../domain/contract-paper.ts'
import { findContract, getContractVersion, renderClauses } from './contract.ts'
import { CONTRACT_MSG, CONTRACT_PAPER } from '../../terms/contract-doc.ts'

export const CONTRACT_EXPORT_FORMATS = ['pdf', 'docx', 'html'] as const
export type ContractExportFormat = (typeof CONTRACT_EXPORT_FORMATS)[number]

const CONTENT_TYPE: Record<ContractExportFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  html: 'text/html; charset=utf-8',
}

export function parseExportFormat(raw: string | null): ContractExportFormat {
  const f = CONTRACT_EXPORT_FORMATS.find((x) => x === raw)
  if (!f) throw new CrmError('VALIDATION_FAILED', CONTRACT_PAPER.badFormat, { field: 'format' })
  return f
}

/** 빈 값은 지금 버전(null). 숫자가 아니면 막는다 — 조용히 지금 버전으로 굽으면 다른 종이가 나간다 */
export function parseVersionNo(raw: string | null): number | null {
  if (raw === null || raw === '') return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) throw new CrmError('VALIDATION_FAILED', CONTRACT_MSG.badVersionNo, { field: 'version' })
  return n
}

/** 굽는 재료 — 화면 미리보기와 파일이 이 하나를 쓴다 */
export async function loadContractPaper(db: CrmDb, contractId: string, versionNo: number | null): Promise<ContractPaperInput> {
  const contract = await findContract(db, contractId)
  const v = await getContractVersion(db, contractId, versionNo ?? contract.currentVersionNo)
  return {
    contractNo: contract.contractNo,
    title: contract.title,
    versionNo: v.versionNo,
    clauses: renderClauses(v.body, v.fieldValues, v.quoteSnapshot),
    fieldValues: v.fieldValues,
    signature: v.signatureSnapshot
      ? { partyA: v.signatureSnapshot.partyA, partyB: v.signatureSnapshot.partyB, mark: v.signatureSnapshot.mark, showCeo: v.signatureSnapshot.showCeo }
      : null,
  }
}

export interface ContractFile {
  body: Uint8Array | string
  contentType: string
  fileName: string
  versionNo: number
}

export async function exportContract(
  db: CrmDb, contractId: string, opts: { format: ContractExportFormat; versionNo: number | null },
): Promise<ContractFile> {
  const paper = await loadContractPaper(db, contractId, opts.versionNo)
  const base = { contentType: CONTENT_TYPE[opts.format], versionNo: paper.versionNo }
  if (opts.format === 'html') {
    return { ...base, body: contractPaperHtml(paper), fileName: contractFileName(paper, 'pdf').replace(/\.pdf$/, '.html') }
  }
  if (opts.format === 'docx') {
    const buf = await Packer.toBuffer(buildContractDocx(paper))
    return { ...base, body: new Uint8Array(buf), fileName: contractFileName(paper, 'docx') }
  }
  const { renderDocument } = await import('../../export/render-document.ts')
  const bytes = await renderDocument({ html: contractPaperHtml(paper), format: 'pdf', route: 'crm/contracts/export', pdfMargin: '0' })
  return { ...base, body: bytes, fileName: contractFileName(paper, 'pdf') }
}
