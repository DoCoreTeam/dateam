/**
 * 파서 라우터 (설계서 3.3.4)
 *
 * ## 라우터가 하는 일은 셋뿐이다
 *
 * 1 이름과 내용이 같은 것을 가리키는지 확인하고
 * 2 종류에 맞는 파서를 순서대로 시도하고
 * 3 **어느 파서가 읽었는지 IR meta 에 남긴다.**
 *
 * 3번이 없으면 나중에 「이 문서를 다시 파싱해야 하나」를 판단할 수 없다.
 * 파서를 올렸을 때 무엇을 다시 읽어야 하는지는 파서 이름과 판으로만 알 수 있다.
 *
 * ## 폴백을 두는 이유
 *
 * HWPX 는 한글 파서가 읽는 것이 정확하지만, 그 파서가 못 여는 판이 있다.
 * 그때 ZIP+XML 로 읽는 오피스 파서가 **덜 정확하게라도** 읽는 편이
 * 「못 읽음」보다 낫다. 대신 무엇으로 읽었는지 남겨 나중에 다시 읽을 수 있게 한다.
 */

import type { IrDocument } from '../ir/types.ts'
import { checkKind, type DetectedKind, type KindCheck } from './quality.ts'
import { parseHwp, type HwpRejectReason } from './hwp.ts'
import { parseOfficeDoc, type OfficeRejectReason } from './office.ts'

export type ParserName = 'rhwp' | 'officeparser'

export type ParseRejectReason =
  | 'extension_mismatch'
  | 'unknown_kind'
  | 'no_parser'
  | HwpRejectReason
  | OfficeRejectReason

export interface ParseAttempt {
  parser: ParserName
  ok: boolean
  reason: string | null
}

export type ParseResult =
  | { ok: true; doc: IrDocument; scanPages: number[]; attempts: ParseAttempt[] }
  | { ok: false; reason: ParseRejectReason; detail: string; attempts: ParseAttempt[] }

export interface ParseFileInput {
  fileId: string
  fileName: string
  bytes: Uint8Array
  fileRole?: string
}

/**
 * 종류별 파서 순서. 앞이 1순위다.
 *
 * hwpx 에 오피스 파서를 폴백으로 두는 이유는 HWPX 가 ZIP+XML 이라
 * 한글 파서가 못 열어도 글자는 건질 수 있어서다.
 */
const ROUTES: Partial<Record<DetectedKind, readonly ParserName[]>> = {
  hwp: ['rhwp'],
  hwpx: ['rhwp', 'officeparser'],
  pdf: ['officeparser'],
  ooxml: ['officeparser'],
  odf: ['officeparser'],
  rtf: ['officeparser'],
  text: ['officeparser'],
}

/**
 * 파일 하나를 IR 로 만든다.
 *
 * 실패해도 **무엇을 시도했고 왜 안 됐는지**를 함께 돌려준다 —
 * 「파싱 실패」 한 마디로는 사용자가 다음에 무엇을 해야 할지 모른다.
 */
export async function parseFile(input: ParseFileInput): Promise<ParseResult> {
  const attempts: ParseAttempt[] = []

  const kind = checkKind(input.fileName, input.bytes)
  if (!kind.ok) {
    return { ok: false, reason: kind.reason, detail: describeMismatch(kind), attempts }
  }

  const route = ROUTES[kind.kind]
  if (!route || route.length === 0) {
    return { ok: false, reason: 'no_parser', detail: `kind=${kind.kind}`, attempts }
  }

  let lastReason: ParseRejectReason = 'no_parser'
  let lastDetail = ''

  for (const parser of route) {
    if (parser === 'rhwp') {
      const r = await parseHwp(input.bytes, { fileId: input.fileId, fileRole: input.fileRole })
      if (r.ok) {
        attempts.push({ parser, ok: true, reason: null })
        // 한글 파서는 쪽 나눔이 근사라 스캔 쪽 목록을 내지 않는다
        return { ok: true, doc: r.doc, scanPages: [], attempts }
      }
      attempts.push({ parser, ok: false, reason: r.reason })
      lastReason = r.reason
      lastDetail = r.detail
      if (isTerminal(r.reason)) break
      continue
    }

    const r = await parseOfficeDoc(input.bytes, { fileId: input.fileId, fileRole: input.fileRole })
    if (r.ok) {
      attempts.push({ parser, ok: true, reason: null })
      // 어느 파서가 읽었는지 doc.meta 에 남는다. 파서를 올렸을 때 다시 읽을 대상을 이것으로 고른다
      return { ok: true, doc: r.doc, scanPages: r.scanPages, attempts }
    }
    attempts.push({ parser, ok: false, reason: r.reason })
    lastReason = r.reason
    lastDetail = r.detail
    if (isTerminal(r.reason)) break
  }

  return { ok: false, reason: lastReason, detail: lastDetail, attempts }
}

/** 다음 파서를 시도해도 결과가 같은 사유인가 */
function isTerminal(reason: string): boolean {
  return reason === 'drm_distribution'
    || reason === 'password_protected'
    || reason === 'unsupported_format'
}

function describeMismatch(k: Extract<KindCheck, { ok: false }>): string {
  return `declared=${k.declared} actual=${k.actual}`
}

export { checkKind, scoreQuality, isLowQuality, QUALITY_WARN_BELOW, detectKind, kindOfExtension } from './quality.ts'
export { parseHwp, sniffHwp } from './hwp.ts'
export { parseOfficeDoc, astToIr, needsImageText } from './office.ts'
export { unbundle, isZip } from './bundle.ts'
export { guessFileRole, pickMainFile, needsRoleConfirm } from './role.ts'
export {
  chooseRoute, planImageText, estimateImageTextCost, toImageTextBlocks, mergeImageText,
} from './image-text.ts'
