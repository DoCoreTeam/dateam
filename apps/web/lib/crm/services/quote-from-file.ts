/**
 * 견적서 파일 → 견적 «초안»
 *
 * ## 레코드를 만들지 않는다
 *
 * 편집 화면이 그대로 검수할 초안만 돌려주고, 사람이 항목을 체크한 뒤에 저장한다
 * (§5-3 추출/제안형 — 자동 등록 금지). 이 파일에 DB 쓰기가 한 줄도 없는 것이 그 계약이다.
 * 올린 파일도 저장하지 않는다 — 읽고 버린다. 딜 첨부는 이미 따로 있고,
 * 같은 파일이 두 곳에 남으면 지울 때 한 곳이 남는다.
 *
 * ## 길은 둘, 갈림길은 하나
 *
 * 글자가 있는 문서(PDF·엑셀·워드·한글·평문)는 **파서로 읽는다** —
 * RFP 인입이 쓰는 그 파서를 그대로 쓴다(재사용·단일구현 정책). 표는 셀 경계가 살아 있는
 * 글로 펴서 넘긴다.
 *
 * 그림(스캔·사진·캡처)과 **글자가 거의 안 나온 PDF** 는 모델에게 그림째 보여 준다.
 * 스캔 PDF 는 파서가 «빈 문서를 성공으로» 돌려주는 것이 함정이다 — 그대로 두면
 * 화면이 「항목을 못 찾았어요」라고 말하고, 사용자는 이 기능이 그 파일을 못 읽는 줄 안다.
 *
 * 그 판단은 `chooseQuoteFileRoute` 한 곳에서만 한다. 두 곳에서 하면 언젠가 갈린다.
 */

import { checkKind, type DetectedKind } from '../../rfp/parse/quality.ts'
import { parseFile } from '../../rfp/parse/index.ts'
import { kindOfMime, maxBytesForMime } from '../../ai-chat/attachments.ts'
import type { AttachmentInput } from '../../ai-chat/provider.ts'
import { CrmError } from '../domain/errors.ts'
import { getCrmDb } from '../db/client.ts'
import { runAi, type AiAdapter } from '../ai/runner.ts'
import { QUOTE_FROM_DOC_V1 } from '../ai/prompts/quote-from-doc.v1.ts'
import { parseQuoteFromDoc, type QuoteFromDocOutput } from '../ai/schemas/quote-from-doc.ts'
import { adapterFromSetting } from './quick-create.ts'
import { irToSourceText, type SourceTextResult } from './quote-source-text.ts'

/**
 * 파일 하나의 크기 상한.
 *
 * 견적서 한 벌은 스캔본이라도 이 안에 든다. 더 큰 것은 견적서가 아니라 제안서 묶음이고,
 * 그건 통째로 읽을 것이 아니라 견적 쪽만 떼어 올려야 한다.
 */
export const MAX_QUOTE_FILE_BYTES = 20 * 1024 * 1024

/**
 * 받을 수 있는 종류.
 *
 * **zip 은 안 받는다.** 묶음 안에 견적서가 몇 장인지, 어느 것이 최종본인지 우리가 모른다.
 * 모르면서 하나를 골라 읽으면 **옛 판으로 견적을 만든다.**
 */
export const ALLOWED_KINDS: readonly DetectedKind[] = [
  'pdf', 'ooxml', 'odf', 'rtf', 'text', 'hwp', 'hwpx', 'image',
]

/**
 * 「글자를 읽었다」고 볼 최소 글자 수.
 *
 * 견적서 한 장에는 품목·수량·단가가 적어도 몇 백 자 든다. 이보다 적으면
 * 표를 그림으로 붙였거나 스캔본이다 — 파서가 성공을 돌려줬어도 읽은 것이 아니다.
 */
export const MIN_USEFUL_CHARS = 120

export type QuoteFileRoute = 'text' | 'vision'

export type QuoteFileRejectReason =
  | 'too_large'
  | 'unsupported_kind'
  | 'bundle_not_allowed'
  | 'kind_mismatch'
  | 'empty'

export type QuoteFileCheck =
  | { ok: true; kind: DetectedKind }
  | { ok: false; reason: QuoteFileRejectReason; detail: string }

/**
 * 받을 파일인가. **파서를 부르기 전에** 판정한다 —
 * 20MB 짜리를 다 읽고 나서 거절하면 사용자는 그 시간을 그냥 기다린 것이다.
 */
export function checkQuoteFile(input: { fileName: string; bytes: Uint8Array }): QuoteFileCheck {
  if (input.bytes.length === 0) return { ok: false, reason: 'empty', detail: 'bytes=0' }
  if (input.bytes.length > MAX_QUOTE_FILE_BYTES) {
    return { ok: false, reason: 'too_large', detail: `bytes=${input.bytes.length}` }
  }

  const kind = checkKind(input.fileName, input.bytes)
  if (!kind.ok) {
    // 이름과 내용이 다른 파일. 확장자를 믿고 파서를 고르면 엉뚱한 파서가 죽는다
    return { ok: false, reason: 'kind_mismatch', detail: `declared=${kind.declared} actual=${kind.actual}` }
  }
  if (kind.kind === 'zip') {
    return { ok: false, reason: 'bundle_not_allowed', detail: 'zip' }
  }
  if (!ALLOWED_KINDS.includes(kind.kind)) {
    return { ok: false, reason: 'unsupported_kind', detail: kind.kind }
  }
  return { ok: true, kind: kind.kind }
}

/** 처음에 어느 길로 갈까. 그림은 파서가 읽을 것이 없다 */
export function initialQuoteFileRoute(kind: DetectedKind): QuoteFileRoute {
  return kind === 'image' ? 'vision' : 'text'
}

/**
 * 파서로 읽어 본 뒤, **그림째 다시 봐야 하나**.
 *
 * 글자가 거의 안 나왔고 그 형식을 모델에게 그림으로 보낼 수 있을 때만 참이다.
 * 엑셀·워드는 텍스트가 없으면 정말로 빈 문서다 — 그림으로 보낼 것도 없다.
 */
export function needsVisionFallback(kind: DetectedKind, text: string): boolean {
  if (kind !== 'pdf') return false
  return text.trim().length < MIN_USEFUL_CHARS
}

/** 그림째 보낼 때 쓸 MIME. 보낼 수 없는 형식이면 null */
export function visionMime(kind: DetectedKind, declaredMime: string | null): string | null {
  if (kind === 'pdf') return 'application/pdf'
  if (kind !== 'image') return null
  const mime = (declaredMime ?? '').toLowerCase()
  // 첨부 규칙이 받는 그림만. 새 목록을 여기 또 적지 않는다
  if (kindOfMime(mime) === 'image') return mime
  return null
}

export interface QuoteFromFileInput {
  fileName: string
  /** 브라우저가 알려 준 MIME. 믿지 않고 내용으로 다시 본다 */
  mimeType: string | null
  bytes: Uint8Array
}

export interface QuoteFromFileResult {
  draft: QuoteFromDocOutput
  /** 무엇을 읽고 만들었는지 — 사람이 원문과 대조할 수 있어야 한다 */
  source: {
    fileName: string
    route: QuoteFileRoute
    kind: DetectedKind
    /** 파서로 읽은 글. 그림째 읽었으면 빈 문자열이다 */
    text: string
    /** 상한에 걸려 뒤를 잘랐나 */
    truncated: boolean
    /** 표를 몇 개 폈나. 0 이면 화면이 「표로 못 읽었다」고 말한다 */
    tableCount: number
  }
  runId: string
}

/** 사람이 읽을 거절 사유 */
const REJECT_MESSAGE: Record<QuoteFileRejectReason, string> = {
  empty: '빈 파일이에요. 내용이 있는 견적서를 올려 주세요.',
  too_large: `파일이 너무 큽니다. ${Math.round(MAX_QUOTE_FILE_BYTES / (1024 * 1024))}MB 이내로 올려 주세요.`,
  unsupported_kind: 'PDF·엑셀·워드·한글·이미지 파일을 올려 주세요.',
  bundle_not_allowed: '압축 파일은 어느 것이 견적서인지 알 수 없어요. 견적서 파일만 따로 올려 주세요.',
  kind_mismatch: '파일 이름의 확장자와 실제 형식이 달라요. 원본 파일을 그대로 올려 주세요.',
}

/**
 * 파일을 읽어 견적 초안을 만든다.
 *
 * **DB 에 아무것도 쓰지 않는다.** 여기서 나온 값은 화면이 검수 목록으로 보여 주고,
 * 사람이 체크한 것만 폼에 들어간다.
 */
export async function draftQuoteFromFile(
  workspaceId: string,
  input: QuoteFromFileInput,
  adapter?: AiAdapter,
): Promise<QuoteFromFileResult> {
  const check = checkQuoteFile(input)
  if (!check.ok) {
    throw new CrmError('VALIDATION_FAILED', REJECT_MESSAGE[check.reason], {
      field: 'file', reason: check.reason, detail: check.detail,
    })
  }
  const kind = check.kind

  let route = initialQuoteFileRoute(kind)
  let read: SourceTextResult = { text: '', truncated: false, tableCount: 0 }

  if (route === 'text') {
    const parsed = await parseFile({
      fileId: `quote-${Date.now()}`, fileName: input.fileName, bytes: input.bytes, fileRole: 'quote',
    })
    if (parsed.ok) read = irToSourceText(parsed.doc)
    // 스캔 PDF 는 파서가 «빈 문서를 성공으로» 준다. 그대로 두면 「항목 없음」이 뜬다.
    // 파싱이 아예 실패한 PDF 도 같은 길로 보낸다 — 그림으로는 읽힐 수 있다
    if (needsVisionFallback(kind, read.text)) {
      route = 'vision'
    } else if (!parsed.ok) {
      /*
        **왜 못 읽었는지를 함께 남긴다.** 사용자에게는 한 문장이면 되지만,
        「parse_failed」 한 마디로는 고치는 쪽이 파서 문제인지 파일 문제인지 모른다.
        이 값은 시스템 로그로 간다(withCrmApi 가 기록한다).
      */
      throw new CrmError('VALIDATION_FAILED',
        '파일을 읽지 못했어요. 다른 형식으로 저장한 뒤 다시 올려 주세요.',
        { field: 'file', reason: parsed.reason, detail: parsed.detail })
    }
  }

  let attachments: AttachmentInput[] | undefined
  if (route === 'vision') {
    const one = toAttachment(input, kind)
    if (!one) {
      throw new CrmError('VALIDATION_FAILED',
        '이 그림 형식은 읽을 수 없어요. PNG·JPG 로 저장한 뒤 다시 올려 주세요.', { field: 'file' })
    }
    attachments = [one]
  } else if (read.text.trim().length === 0) {
    throw new CrmError('VALIDATION_FAILED',
      '파일에서 글자를 찾지 못했어요. 표가 그림으로 들어간 문서라면 그 쪽을 이미지로 저장해 올려 주세요.',
      { field: 'file' })
  }

  const db = getCrmDb(workspaceId)
  // 어댑터 결정은 여기서 다시 구현하지 않는다 — 호스트 설정 한 곳에서 온다
  const chosen = adapter ?? await adapterFromSetting(db, { attachments })

  /*
    그림째 읽을 때도 프롬프트는 같다. 다른 프롬프트를 쓰면 같은 견적서를
    형식에 따라 다르게 읽게 되고, 그 차이를 사람이 설명할 수 없다.
  */
  const promptInput = route === 'vision'
    ? '이 파일이 견적서다. 표를 그대로 읽어 항목으로 옮겨라.'
    : read.text

  const { output, runId } = await runAi<QuoteFromDocOutput>({
    db, workspaceId, kind: 'QUICK_CREATE',
    prompt: QUOTE_FROM_DOC_V1,
    input: promptInput,
    inputRef: { fileName: input.fileName, kind, route, chars: read.text.length },
    parse: parseQuoteFromDoc,
    adapter: chosen,
  })

  return {
    draft: output,
    source: {
      fileName: input.fileName, route, kind,
      text: read.text, truncated: read.truncated, tableCount: read.tableCount,
    },
    runId,
  }
}

/** 그림째 보낼 첨부로. 크기 상한은 첨부 규칙 한 곳에서 온다 */
function toAttachment(input: QuoteFromFileInput, kind: DetectedKind): AttachmentInput | null {
  const mime = visionMime(kind, input.mimeType)
  if (!mime) return null
  if (input.bytes.length > maxBytesForMime(mime)) return null
  const attKind = kindOfMime(mime)
  if (attKind !== 'image' && attKind !== 'pdf') return null
  return {
    kind: attKind,
    mime,
    filename: input.fileName,
    dataBase64: Buffer.from(input.bytes).toString('base64'),
  }
}
