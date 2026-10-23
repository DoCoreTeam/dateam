// 견적서 서버 내보내기 (P0158 I10)
//
// 재는 것: 형식과 쪽 번호 해석, 믿을 출처 판정(SSRF), 쪽 자르기, 금액 대조 실패 시 막기,
// 그리고 **고객 문서만 나가는가**, 종이가 읽는 모델과 이 창구의 소스에 원가 마진 딜 메모 칸이 없는가.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseQuoteExportFormat, parseQuotePage, parseQuoteExportRequest, resolveExportOrigin,
  quoteScreenUrl, quoteExportFileName, assertExportable, PREVIEW_BUTTON_TEXT, PAPER_SELECTOR, PRINTING_CLASS,
} from './quote-export.ts'
import { pageSlices, pageClipY, A4_H_MM, A4_W_MM } from '../doc/page-fit.ts'
import { QUOTE } from '../terms/quote.ts'

const WEB = fileURLToPath(new URL('../..', import.meta.url))
const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8')

const MODULE = 'lib/quote-export/quote-export.ts'
const ROUTE = 'app/api/crm/quotes/[id]/export/route.ts'
const RENDER = 'lib/export/render-document.ts'
const SHEET = 'app/(crm)/crm/quotes/[id]/QuoteSheet.tsx'
const DOC_MODEL = 'lib/crm/domain/quote-document.ts'

/** 고객 문서에 있으면 안 되는 이름. 원가 마진 딜 메모 매입 */
const FORBIDDEN_WORD = /\b(cost\w*|\w*Cost\w*|margin\w*|\w*Margin\w*|unitCost|dealNote\w*|internalNote\w*|notesMd|purchase\w*|\w*Purchase\w*)\b/g
/** 돈이 아닌 여백. pdf 종이 여백은 원가 마진과 무관하다 */
const NOT_MONEY = new Set(['pdfMargin'])
function forbiddenIn(code: string): string[] {
  return [...code.matchAll(FORBIDDEN_WORD)].map((m) => m[1]).filter((w) => !NOT_MONEY.has(w))
}

function codeOnly(src: string): string {
  // 주석을 걷어낸 코드만 본다, 설명 글에 낱말이 나오는 것은 값이 나가는 것이 아니다
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('형식은 pdf png 둘뿐이고 없거나 모르면 막는다', () => {
  assert.equal(parseQuoteExportFormat('pdf'), 'pdf')
  assert.equal(parseQuoteExportFormat('png'), 'png')
  for (const bad of [null, '', 'xlsx', 'PDF', 'jpg']) {
    assert.throws(() => parseQuoteExportFormat(bad), (e: Error & { code?: string }) => e.code === 'VALIDATION_FAILED')
  }
})

test('쪽 번호는 비면 1, 1 이상 정수만 받는다', () => {
  assert.equal(parseQuotePage(null), 1)
  assert.equal(parseQuotePage(''), 1)
  assert.equal(parseQuotePage('3'), 3)
  for (const bad of ['0', '-1', '1.5', 'abc', '1e2', '99999999999999999999']) {
    assert.throws(() => parseQuotePage(bad), (e: Error & { code?: string }) => e.code === 'VALIDATION_FAILED', bad)
  }
})

test('png 만 쪽을 갖고 pdf 는 문서 전체다', () => {
  assert.deepEqual(parseQuoteExportRequest(new URLSearchParams('format=png&page=2')), { format: 'png', page: 2 })
  assert.deepEqual(parseQuoteExportRequest(new URLSearchParams('format=png')), { format: 'png', page: 1 })
  assert.deepEqual(parseQuoteExportRequest(new URLSearchParams('format=pdf&page=2')), { format: 'pdf', page: null })
})

test('출처: Vercel 밖에서는 이 기계 주소만 받는다', () => {
  assert.equal(resolveExportOrigin('http://localhost:3000', {}), 'http://localhost:3000')
  assert.equal(resolveExportOrigin('http://127.0.0.1:3300', {}), 'http://127.0.0.1:3300')
  assert.equal(resolveExportOrigin('http://169.254.169.254', {}), null)
  assert.equal(resolveExportOrigin('http://10.0.0.5:8080', {}), null)
  assert.equal(resolveExportOrigin('https://evil.example', {}), null)
  assert.equal(resolveExportOrigin('file:///etc/passwd', {}), null)
  assert.equal(resolveExportOrigin('not a url', {}), null)
})

test('출처: Vercel 위에서는 Vercel 이 알려 준 우리 주소만, 아니면 운영 주소로 바꾼다', () => {
  const env = { VERCEL: '1', VERCEL_URL: 'app-abc.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'teamda.example.com' }
  assert.equal(resolveExportOrigin('https://teamda.example.com', env), 'https://teamda.example.com')
  assert.equal(resolveExportOrigin('https://app-abc.vercel.app', env), 'https://app-abc.vercel.app')
  // Host 를 고쳐 보낸 요청은 그 주소를 안 연다
  assert.equal(resolveExportOrigin('https://169.254.169.254', env), 'https://teamda.example.com')
  assert.equal(resolveExportOrigin('http://localhost:9001', env), 'https://teamda.example.com')
  // http 로 온 우리 주소도 https 운영 주소로 연다
  assert.equal(resolveExportOrigin('http://teamda.example.com', env), 'https://teamda.example.com')
  assert.equal(resolveExportOrigin('http://localhost:9001', { VERCEL: '1' }), null)
})

test('여는 화면은 견적 상세이고 id 는 주소 조각으로 감싼다', () => {
  assert.equal(quoteScreenUrl('http://localhost:3000', 'q1'), 'http://localhost:3000/crm/quotes/q1')
  assert.equal(quoteScreenUrl('http://localhost:3000', '../x?y'), 'http://localhost:3000/crm/quotes/..%2Fx%3Fy')
})

test('파일 이름은 화면 내려받기와 같은 규칙이고 2쪽부터 쪽 번호가 붙는다', () => {
  const head = { supplier: { name: '우리' }, customer: { companyName: '고객' }, meta: { quoteNo: 'Q-1' } }
  assert.equal(quoteExportFileName(head, { format: 'pdf', page: null }), `[우리]고객_Q-1_${QUOTE.documentTitle}.pdf`)
  assert.equal(quoteExportFileName(head, { format: 'png', page: 1 }), `[우리]고객_Q-1_${QUOTE.documentTitle}.png`)
  assert.equal(quoteExportFileName(head, { format: 'png', page: 2 }), `[우리]고객_Q-1_${QUOTE.documentTitle}_2.png`)
})

test('금액이 어긋난 문서와 믿을 수 없는 출처는 굽기 전에 막는다', () => {
  assert.throws(() => assertExportable({ violations: [{ message: '합계가 다름' }], origin: 'http://localhost:3000' }),
    (e: Error & { code?: string }) => e.code === 'CONFLICT' && e.message.includes('합계가 다름'))
  assert.throws(() => assertExportable({ violations: [], origin: null }),
    (e: Error & { code?: string }) => e.code === 'FORBIDDEN')
  assert.equal(assertExportable({ violations: [], origin: 'http://localhost:3000' }), 'http://localhost:3000')
})

test('쪽 자르기: 한 장이면 1쪽, 넘치면 A4 비율로 나눈다', () => {
  const w = 794
  const pageH = w * (A4_H_MM / A4_W_MM)
  assert.equal(pageSlices(pageH, w).count, 1)
  assert.equal(pageSlices(pageH + 1, w).count, 1, '반올림 한 픽셀은 봐준다')
  assert.equal(pageSlices(pageH + 50, w).count, 2)
  assert.deepEqual(pageClipY(pageH + 50, w, 2), { y: pageH, height: 50 })
  assert.equal(pageClipY(pageH, w, 2), null)
  assert.equal(pageClipY(pageH, w, 0), null)
})

test('★ 화면 미리보기를 그대로 연다: 같은 단추 글자, 같은 종이, 같은 인쇄 규칙', () => {
  assert.equal(PREVIEW_BUTTON_TEXT, QUOTE.openPreview)
  const view = read('app/(crm)/crm/quotes/[id]/QuoteDocumentView.tsx')
  assert.ok(view.includes('QUOTE.openPreview'), '견적 상세가 미리보기 단추 글자를 바꿨다')
  assert.ok(view.includes('<QuoteSheet') && view.includes('surface="paper"'), '미리보기가 QuoteSheet 종이를 안 그린다')
  const surface = read('components/ui/doc/DocSurface.tsx')
  assert.ok(surface.includes(PAPER_SELECTOR.slice(1)), 'DocSurface 가 종이 표시를 안 붙인다')
  assert.ok(surface.includes('nextFit') && surface.includes('--doc-fit'), '미리보기가 page-fit 으로 한 장 맞춤을 안 건다')
  const css = read('app/globals.css')
  assert.ok(css.includes(`body.${PRINTING_CLASS} > *:not(.doc-overlay)`), '보일 것만 남기는 인쇄 규칙이 없다')
})

test('★ 굽기는 render-document 한 자리를 지나고 새 HTML 을 짓지 않는다', () => {
  const src = codeOnly(read(MODULE))
  assert.match(src, /import\('\.\.\/export\/render-document\.ts'\)/)
  assert.match(src, /visit:\s*\{/, '화면을 여는 길이 아니다')
  assert.doesNotMatch(src, /<table|<html|<div|setContent|puppeteer/, '이 창구가 HTML 을 따로 짓고 있다')
  const render = read(RENDER)
  assert.match(render, /emulateMediaType\('print'\)/, '인쇄 규칙으로 안 그린다')
  assert.match(render, /setRequestInterception\(true\)/, '출처 밖 요청을 안 끊는다')
})

test('★ 원가 마진 딜 메모 없음: 종이가 읽는 문서 모델에 그 칸이 없다', () => {
  const src = read(DOC_MODEL)
  const start = src.indexOf('export interface DocumentSupplier')
  const end = src.indexOf('export interface BuildQuoteDocumentInput')
  assert.ok(start > 0 && end > start, '문서 모델 경계를 못 찾았다')
  const fields = [...codeOnly(src.slice(start, end)).matchAll(/^\s*(?:readonly\s+)?(\w+)\??\s*:/gm)].map((m) => m[1])
  assert.ok(fields.length > 30, `모델 칸을 ${fields.length}개만 셌다, 정규식이 낡았다`)
  const bad = fields.filter((f) => forbiddenIn(f).length > 0)
  assert.deepEqual(bad, [], `고객 문서 모델에 원가 마진 메모 칸이 있다: ${bad.join(', ')}`)
})

test('★ 원가 마진 딜 메모 없음: 종이 컴포넌트와 이 창구의 코드가 그 이름을 안 부른다', () => {
  for (const rel of [MODULE, ROUTE, SHEET]) {
    const hit = forbiddenIn(codeOnly(read(rel)))
    assert.deepEqual(hit, [], `${rel} 이 ${hit.join(', ')} 을 부른다`)
  }
  // 종이는 고객 문서 모델 하나만 받는다
  assert.match(read(SHEET), /doc: QuoteDocument/)
  // 가드가 눈을 뜨고 있다: 원가 이름을 넣으면 잡힌다
  assert.deepEqual(forbiddenIn('const x = line.costMinor + q.marginRate; pdfMargin'), ['costMinor', 'marginRate'])
})

test('★ 보안: 읽기 권한(withCrmApi READONLY)과 내보내기 판정을 둘 다 지난다', () => {
  const src = codeOnly(read(ROUTE))
  assert.match(src, /withCrmApi\('READONLY'/)
  assert.match(src, /canExport\('\/crm'\)/)
  assert.match(src, /resolveExportOrigin\(/, '요청 Host 를 그대로 믿는다')
  // 판정은 문서를 읽기 전에 선다
  assert.ok(src.indexOf('canExport(') < src.indexOf('getQuoteDocument('), '문서를 읽은 뒤에 판정한다')
})
