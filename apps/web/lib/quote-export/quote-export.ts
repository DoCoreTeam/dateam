/**
 * 견적서 서버 내보내기, PDF 와 쪽 이미지 (P0158 I10)
 *
 * **새 배치를 안 짓는다.** 견적서 본문은 화면 컴포넌트(QuoteSheet) 한 벌이고(정책 2-7 D-7),
 * 한 장 맞춤도 미리보기(DocSurface)가 lib/doc/page-fit 으로 재서 건다. 서버가 HTML 을 따로
 * 지으면 그날부터 화면과 파일이 다른 문서다. 그래서 요청한 사람의 쿠키로 견적 화면을 열고
 * 미리보기를 띄워 그 종이를 그대로 굽는다(render-document 의 visit).
 *
 * **고객 문서만 나간다.** 종이가 읽는 것은 `QuoteDocument` 하나이고 그 안에 원가 마진 딜 메모가
 * 없다. 찍기 전에 body 에 doc-printing 을 붙여 인쇄 규칙이 종이 밖(상세 화면의 원가 패널 등)을
 * 전부 숨긴다. 여기서 받는 재료도 파일 이름과 금액 대조 결과뿐이다.
 *
 * render-document 는 server-only 라 필요할 때만 읽는다, 이 파일이 시험에서 열리게.
 */

import { CrmError } from '../crm/domain/errors.ts'
import { exportFileName } from '../crm/domain/quote-document.ts'
import { QUOTE, QUOTE_EXPORT } from '../terms/quote.ts'

export const QUOTE_EXPORT_FORMATS = ['pdf', 'png'] as const
export type QuoteExportFormat = (typeof QUOTE_EXPORT_FORMATS)[number]

const CONTENT_TYPE: Record<QuoteExportFormat, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
}

/** 미리보기를 여는 단추 글자. 화면과 같은 용어를 읽는다, 글자가 바뀌어도 여기가 따라간다 */
export const PREVIEW_BUTTON_TEXT = QUOTE.openPreview
/** 미리보기 종이. DocSurface 가 붙이는 전역 표시다 */
export const PAPER_SELECTOR = '.doc-paper'
/** 인쇄 규칙이 「보일 것만 남기기」를 거는 표시 (globals.css) */
export const PRINTING_CLASS = 'doc-printing'

export interface QuoteExportRequest {
  format: QuoteExportFormat
  /** png 의 쪽(1부터). pdf 는 문서 전체라 안 쓴다 */
  page: number | null
}

/** 형식이 없거나 모르는 값이면 막는다. 조용히 pdf 로 굽으면 부른 쪽이 고른 것과 다른 파일이 나간다 */
export function parseQuoteExportFormat(raw: string | null): QuoteExportFormat {
  const f = QUOTE_EXPORT_FORMATS.find((x) => x === raw)
  if (!f) throw new CrmError('VALIDATION_FAILED', QUOTE_EXPORT.badFormat, { field: 'format' })
  return f
}

/** 쪽 번호. 비면 1쪽. 1 이상 정수가 아니면 막는다 */
export function parseQuotePage(raw: string | null): number {
  if (raw === null || raw === '') return 1
  if (!/^\d+$/.test(raw)) throw new CrmError('VALIDATION_FAILED', QUOTE_EXPORT.badPage, { field: 'page' })
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n < 1) throw new CrmError('VALIDATION_FAILED', QUOTE_EXPORT.badPage, { field: 'page' })
  return n
}

export function parseQuoteExportRequest(params: URLSearchParams): QuoteExportRequest {
  const format = parseQuoteExportFormat(params.get('format'))
  const page = parseQuotePage(params.get('page'))
  return { format, page: format === 'png' ? page : null }
}

/** 출처를 정할 때 보는 환경값. 전부 Vercel 이 스스로 넣는 값이라 새 설정이 아니다 */
export interface OriginEnv {
  VERCEL?: string
  VERCEL_URL?: string
  VERCEL_BRANCH_URL?: string
  VERCEL_PROJECT_PRODUCTION_URL?: string
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function hostOf(raw: string | undefined): string | null {
  if (!raw) return null
  try { return new URL(raw.includes('://') ? raw : `https://${raw}`).host } catch { return null }
}

/**
 * 헤드리스가 열 출처. 믿을 수 없으면 null.
 *
 * 요청의 Host 는 보내는 쪽이 고칠 수 있다. 그대로 믿으면 서버 안 브라우저가 남이 고른 주소
 * (사설망, 람다 내부 포트)를 연다(SSRF). 그래서 Vercel 위에서는 Vercel 이 알려 준 우리 주소만,
 * 그 밖(로컬 개발과 로컬 운영 빌드)에서는 이 기계 주소만 받는다.
 */
export function resolveExportOrigin(requestOrigin: string, env: OriginEnv): string | null {
  let req: URL
  try { req = new URL(requestOrigin) } catch { return null }
  if (req.protocol !== 'http:' && req.protocol !== 'https:') return null

  if (!env.VERCEL) return LOCAL_HOSTS.has(req.hostname === '::1' ? '[::1]' : req.hostname) ? req.origin : null

  const own = [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_BRANCH_URL, env.VERCEL_URL]
    .map(hostOf)
    .filter((h): h is string => h !== null)
  if (req.protocol === 'https:' && own.includes(req.host)) return req.origin
  const prod = hostOf(env.VERCEL_PROJECT_PRODUCTION_URL)
  return prod ? `https://${prod}` : null
}

/** 헤드리스가 열 화면. 견적 상세가 미리보기를 품고 있다 */
export function quoteScreenUrl(origin: string, quoteId: string): string {
  return `${origin}/crm/quotes/${encodeURIComponent(quoteId)}`
}

/** 파일 이름. 화면의 내려받기와 같은 규칙(exportFileName)이다 */
export function quoteExportFileName(
  doc: Parameters<typeof exportFileName>[0], req: QuoteExportRequest,
): string {
  const base = exportFileName(doc, QUOTE.documentTitle, req.format)
  if (req.format !== 'png' || req.page === null || req.page === 1) return base
  return base.replace(/\.png$/, `_${req.page}.png`)
}

export interface QuoteExportInput {
  quoteId: string
  /** 파일 이름에 쓰는 머리 정보만 받는다, 종이 내용은 화면이 그린다 */
  head: Parameters<typeof exportFileName>[0]
  /** 금액 대조 결과. 하나라도 있으면 굽지 않는다 */
  violations: { message: string }[]
  /** resolveExportOrigin 이 믿은 출처. null 이면 굽지 않는다 */
  origin: string | null
  /** 요청한 사람의 쿠키 */
  cookies: { name: string; value: string }[]
  request: QuoteExportRequest
}

export interface QuoteFile {
  body: Uint8Array
  contentType: string
  fileName: string
}

/** 굽기 전에 막을 것을 먼저 본다. 브라우저를 띄운 뒤에 막으면 몇 초를 버린다 */
export function assertExportable(input: Pick<QuoteExportInput, 'violations' | 'origin'>): string {
  // 어긋난 문서는 파일로 내보내지 않는다, 파일은 그대로 고객에게 가고 되돌릴 방법이 없다
  if (input.violations.length > 0) {
    throw new CrmError('CONFLICT', `${QUOTE_EXPORT.mismatch}\n${input.violations.map((v) => v.message).join('\n')}`)
  }
  if (!input.origin) throw new CrmError('FORBIDDEN', QUOTE_EXPORT.untrustedOrigin)
  return input.origin
}

export async function exportQuote(input: QuoteExportInput): Promise<QuoteFile> {
  const origin = assertExportable(input)
  const { renderDocument, PageOutOfRange } = await import('../export/render-document.ts')
  const { format, page } = input.request
  try {
    const body = await renderDocument({
      visit: {
        url: quoteScreenUrl(origin, input.quoteId),
        cookies: input.cookies,
        clickText: PREVIEW_BUTTON_TEXT,
        readySelector: PAPER_SELECTOR,
        bodyClass: PRINTING_CLASS,
      },
      format,
      route: 'crm/quotes/export',
      clip: PAPER_SELECTOR,
      page: page ?? undefined,
      // 여백은 종이가 갖는다(정책 2-7 D-4), 여기서 또 주면 인쇄 폭이 화면과 달라진다
      pdfMargin: '0',
    })
    return { body, contentType: CONTENT_TYPE[format], fileName: quoteExportFileName(input.head, input.request) }
  } catch (e) {
    if (e instanceof PageOutOfRange) {
      throw new CrmError('VALIDATION_FAILED', QUOTE_EXPORT.pageOutOfRange(e.count), { field: 'page' })
    }
    throw e
  }
}
