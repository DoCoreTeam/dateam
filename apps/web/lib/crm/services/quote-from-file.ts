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
 *
 * ## 한 파일에 견적 여러 건
 *
 * 한 딜에 견적이 하나일 이유가 없다. 1안·2안이 한 장에 들어오고, 받은 견적서와
 * 우리 견적서가 한 파일에 붙어 오기도 한다. 그래서 **건 목록**을 돌려준다.
 *
 * 건마다 `origin` 라벨이 붙지만 **그 라벨은 알림이다.** 그 건을 새 견적으로 쓸지,
 * 있는 견적에 붙일지, 원가로 넣을지는 **여기서 정하지 않는다** — 문서를 봐서는
 * 알 수 없는 사람의 의도이고, 화면에서 사람이 고른다(사용자 지시 2026-09-19).
 */

import { checkKind, type DetectedKind } from '../../rfp/parse/quality.ts'
import { parseFile } from '../../rfp/parse/index.ts'
import { kindOfMime, maxBytesForMime } from '../../ai-chat/attachments.ts'
import type { AttachmentInput } from '../../ai-chat/provider.ts'
import { CrmError } from '../domain/errors.ts'
import { getCrmDb } from '../db/client.ts'
import { runAi, type AiAdapter } from '../ai/runner.ts'
import { QUOTE_FROM_DOC_V1 } from '../ai/prompts/quote-from-doc.v1.ts'
import {
  parseQuoteFromDocDoc, type QuoteFromDocDoc, type QuoteFromDocQuote,
} from '../ai/schemas/quote-from-doc.ts'
import { judgeQuoteOrigin, type QuoteOrigin } from '../domain/quote-origin.ts'
import { adapterFromSetting } from './quick-create.ts'
import { readQuoteSupplier } from './setting.ts'
import { irToSourceText, type SourceTextResult } from './quote-source-text.ts'
import { readQuoteImportConfig } from './quote-import-config.ts'
import { restoreComponents } from '../domain/quote-components.ts'

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

/**
 * 읽은 건 하나.
 *
 * `origin` 은 **알림이다.** 우리가 낸 문서로 보이는지 받은 문서로 보이는지 화면이
 * 한 줄로 말해 줄 뿐, 그 값이 도착지(새 견적·붙이기·원가)를 정하지 않는다
 * (`domain/quote-origin.ts` 머리말).
 */
export interface QuoteFromFileQuote extends QuoteFromDocQuote {
  origin: QuoteOrigin
}

export interface QuoteFromFileResult {
  /** 한 파일에서 읽은 견적 건들. 한 건짜리 문서면 하나다 */
  quotes: QuoteFromFileQuote[]
  /** 못 읽은 부분 — 어느 건에도 안 들어간 이야기까지 여기 모인다 */
  unclear: string[]
  /** 상한에 걸려 못 읽은 건 수. 0 이 아니면 화면이 그 수를 말한다 */
  droppedQuotes: number
  /** 상한에 걸려 못 읽은 항목 수 */
  droppedLines: number
  /** 상한에 걸려 못 읽은 구성 줄 수 */
  droppedComponents: number
  /**
   * 화면이 이어서 해야 할 일에 필요한 설정.
   *
   * **화면이 설정을 따로 읽지 않는다** — 읽으면 요청이 한 번 더 늘고, 무엇보다
   * 읽은 시점이 달라 서버가 쓴 상한과 화면이 믿는 상한이 갈릴 수 있다.
   */
  options: {
    /** 건마다 그 쪽을 오려 붙일까 (`quote.import.snapshot`) */
    snapshot: boolean
  }
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
    /**
     * 글에 실제로 들어간 쪽 번호들.
     *
     * 한 쪽짜리 문서는 원문에 쪽 표시가 안 붙으므로 모델이 쪽을 말할 수 없다.
     * 그때는 이 목록이 유일한 근거다 — 화면이 「이 건은 1쪽」이라고 채워 넣는다.
     */
    pages: number[]
  }
  runId: string
  /** 고른 모델이 막혀 다른 것이 답했으면 그 사실 — **조용히 바꾸지 않는다** */
  switchedNote?: string
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
  /** 파일을 올린 구성원 */
  actorId: string | null,
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

  /*
    **설정을 먼저 읽는다.** 얼마나 읽을지가 파서를 부르기 전에 정해져야 한다 —
    다 읽고 나서 자르면 그 시간은 이미 쓴 것이고, 모델에 넘긴 글자도 이미 넘긴 것이다.
  */
  const db = getCrmDb(workspaceId)
  const config = await readQuoteImportConfig(db)
  const limits = { maxLines: config.maxLines, maxComponentLines: config.maxComponentLines }

  let route = initialQuoteFileRoute(kind)
  let read: SourceTextResult = { text: '', truncated: false, tableCount: 0, pages: [] }

  if (route === 'text') {
    const parsed = await parseFile({
      fileId: `quote-${Date.now()}`, fileName: input.fileName, bytes: input.bytes, fileRole: 'quote',
    })
    if (parsed.ok) read = irToSourceText(parsed.doc, { maxChars: config.maxChars })
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

  // 어댑터 결정은 여기서 다시 구현하지 않는다 — 호스트 설정 한 곳에서 온다
  const chosen = adapter ?? await adapterFromSetting(db, { attachments, actorId })

  /*
    그림째 읽을 때도 프롬프트는 같다. 다른 프롬프트를 쓰면 같은 견적서를
    형식에 따라 다르게 읽게 되고, 그 차이를 사람이 설명할 수 없다.
  */
  const promptInput = route === 'vision'
    ? '이 파일이 견적서다. 표를 그대로 읽어 항목으로 옮겨라.'
    : read.text

  const { output, runId, switchedNote } = await runAi<QuoteFromDocDoc>({

    actorId: actorId,
    db, workspaceId, kind: 'QUICK_CREATE',
    prompt: QUOTE_FROM_DOC_V1,
    input: promptInput,
    inputRef: { fileName: input.fileName, kind, route, chars: read.text.length },
    // 상한은 설정에서 온다 — 스키마에 박아 두면 회사마다 다른 견적서 두께를 못 따라간다
    parse: (text: string) => parseQuoteFromDocDoc(text, limits),
    adapter: chosen,
  })

  /*
    우리 상호는 설정에서 온다. **못 읽으면 라벨을 안 붙인다** — 설정이 빈 워크스페이스에서
    「받은 문서」라고 말하면 우리가 낸 견적서가 전부 남의 것이 된다(quote-origin.ts).
  */
  const ourName = await readQuoteSupplier(db).then((s) => s.name).catch(() => '')
  /*
    **한 쪽짜리 문서는 쪽을 우리가 채운다.**

    원문에 쪽 표시를 붙이는 것은 쪽이 둘 이상일 때뿐이다(표시가 하나뿐이면 아무것도
    안 알려 주면서 글자만 먹는다). 그래서 한 장짜리 견적서는 모델이 쪽을 말할 수 없고
    pageStart 가 null 로 온다 — 그런데 그 문서의 모든 건은 **분명히 그 한 쪽에 있다.**
    비워 두면 조각도 안 만들어지고 대조도 1쪽으로 떨어진다. 아는 것을 안 쓰는 셈이다.

    쪽이 여럿인 문서에서는 절대 넘겨짚지 않는다 — 틀린 쪽을 오려 붙이는 것이
    안 오리는 것보다 나쁘다.
  */
  const onlyPage = read.pages.length === 1 ? read.pages[0] : null

  /*
    **합쳐져 온 구성을 원문 줄 경계로 되살린다.**

    지시를 또렷하게 써도 모델은 가끔 구성을 규격 한 칸에 이어 붙여 돌려준다.
    그러면 견적서에 한 문단으로 쭉 이어져 어디서 끊기는지 사람이 못 읽는다
    (사용자 지적 2026-09-21). 그런데 **우리는 원문을 갖고 있다** — 합쳐진 글이
    원문의 연속된 줄들과 정확히 맞아떨어지면 그 경계를 되살릴 수 있다.
    맞아떨어지지 않으면 손대지 않는다(`domain/quote-components.ts`).

    그림째 읽은 경우에는 원문 글이 없어 되살릴 것도 없다 — 그때는 빈 배열이 넘어간다.
  */
  const sourceLines = read.text ? read.text.split('\n') : []
  const quotes: QuoteFromFileQuote[] = output.quotes.map((q) => ({
    ...q,
    lines: q.lines.map((l) => restoreComponents(l, sourceLines)),
    pageStart: q.pageStart ?? onlyPage,
    pageEnd: q.pageEnd ?? q.pageStart ?? onlyPage,
    origin: judgeQuoteOrigin({ documentSupplierName: q.supplierName, ourSupplierName: ourName }),
  }))

  return {
    quotes,
    unclear: output.unclear,
    droppedQuotes: output.droppedQuotes,
    droppedLines: output.droppedLines,
    droppedComponents: output.droppedComponents,
    options: { snapshot: config.snapshot },
    source: {
      fileName: input.fileName, route, kind,
      text: read.text, truncated: read.truncated, tableCount: read.tableCount,
      pages: read.pages,
    },
    runId,
    switchedNote,
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
