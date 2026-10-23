// 문서를 파일로 굽는 한 자리 (서버 전용 · SSOT).
//
// 왜 한 자리인가 (실측 2026-09-30):
//   헤드리스로 문서를 그리는 창구가 셋인데(회의록 내보내기, AI 채팅 내보내기 둘) 같은 코드가
//   세 벌로 복사돼 있었다. 그래서 한글 자형이 빠진 사고도 **세 곳에 동시에** 났고, 한 곳만
//   고치면 나머지 둘은 조용히 깨진 채 남는다. 굽는 일은 여기서만 한다.
//
// 자형을 왜 여기서 넣나: 서버 크로미움에는 한글 자형이 하나도 없다
//   (`@sparticuz/chromium@149` 의 `bin/fonts.tar.br` 를 풀면 Open Sans 셋뿐).
//   문서 HTML 은 그대로 두고 **굽기 직전에** 자형을 얹는다 — 그래야 미리보기로 내보낸 HTML 과
//   파일이 같은 문서로 남고, 1MB 짜리 자형이 브라우저로 새어 나가지 않는다.
import 'server-only'
import { buildKoreanFontCss } from './embed-korean-font.ts'
import { pageClipY, pageSlices } from '../doc/page-fit.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any

/**
 * 우리 앱 화면을 **그 사람으로** 열어 굽는다 (견적서 서버 내보내기, P0158 I10).
 *
 * 왜 HTML 을 따로 안 짓나: 견적서 본문은 화면 컴포넌트(QuoteSheet) 한 벌이고(정책 2-7 D-7),
 * 한 장 맞춤(page-fit)도 미리보기(DocSurface)가 재서 건다. 서버가 HTML 을 또 지으면
 * 그날부터 화면과 파일이 다른 문서가 된다. 그래서 미리보기를 그대로 열어 찍는다.
 *
 * 이 출처 밖으로는 요청이 하나도 안 나간다(가로채서 끊음). 출처를 믿을지는 부르는 쪽이 정한다.
 */
export interface VisitOptions {
  /** 열 화면의 전체 주소. 출처(origin)는 부르는 쪽이 이미 믿을 수 있다고 판정한 것이어야 한다 */
  url: string
  /** 요청한 사람의 쿠키. 그 사람이 볼 수 있는 것만 보인다 */
  cookies: { name: string; value: string }[]
  /** 화면을 연 뒤 이 글자가 든 단추를 누른다(미리보기 열기). 없으면 안 누른다 */
  clickText?: string
  /** 이것이 보이면 문서가 그려진 것 */
  readySelector: string
  /** 찍기 전에 body 에 붙일 클래스. 인쇄 규칙이 「보일 것만 남기기」를 이 표시로 건다 */
  bodyClass?: string
}

export interface RenderOptions {
  /** 구울 문서. 완성된 HTML 문자열이며 외부 URL 을 안 연다(SSRF 무관). visit 과 둘 중 하나 */
  html?: string
  /** 우리 앱 화면을 열어 굽는다. html 과 둘 중 하나 */
  visit?: VisitOptions
  format: 'pdf' | 'png'
  /** 실패를 어디서 기록할지 — 자형을 못 읽었을 때 남길 자리 이름 */
  route: string
  /** png 일 때 이 선택자만 잘라 찍는다. 없으면 문서 전체. */
  clip?: string
  /** png 일 때의 문서 폭. pdf 는 A4 고정이라 안 쓴다. */
  width?: number
  /** pdf 여백. 창구마다 다르게 잡아 온 값이라 넘겨받는다. */
  pdfMargin?: string
  /** png 일 때 clip 자리를 A4 쪽으로 잘라 이 쪽(1부터)만 찍는다. 범위 밖이면 던진다 */
  page?: number
}

/** 쪽 번호가 문서 쪽 수를 넘었다. 창구가 400 으로 바꿔 말한다 */
export class PageOutOfRange extends Error {
  constructor(readonly page: number, readonly count: number) {
    super(`page ${page} out of range (1..${count})`)
    this.name = 'PageOutOfRange'
  }
}

/** 화면이 그려지기를 기다리는 상한. 넘으면 던진다, 빈 종이를 굽지 않는다 */
const VISIT_TIMEOUT_MS = 25_000
/** 한 장 맞춤이 재고 줄이기를 마칠 틈. 미리보기는 그림 한두 장 안에 멈춘다 */
const FIT_SETTLE_MS = 400

/** 이 출처 안의 요청인가. data: blob: 은 문서 안의 그림이라 둔다 */
function sameOrigin(url: string, origin: string): boolean {
  if (url.startsWith('data:') || url.startsWith('blob:')) return true
  try { return new URL(url).origin === origin } catch { return false }
}

/** 화면을 열고 미리보기를 띄운 뒤 그려질 때까지 기다린다 */
async function openVisit(page: Page, v: VisitOptions): Promise<void> {
  const origin = new URL(v.url).origin
  // 출처 밖 요청은 전부 끊는다(SSRF). 리다이렉트로 밖에 나가려 해도 여기서 막힌다
  await page.setRequestInterception(true)
  page.on('request', (req: Page) => {
    try { if (sameOrigin(req.url(), origin)) req.continue(); else req.abort() } catch { /* noop */ }
  })
  page.setDefaultTimeout(VISIT_TIMEOUT_MS)
  if (v.cookies.length > 0) {
    await page.setCookie(...v.cookies.map((c) => ({ name: c.name, value: c.value, url: origin })))
  }
  await page.goto(v.url, { waitUntil: 'networkidle2', timeout: VISIT_TIMEOUT_MS })
  if (v.clickText) {
    const label = v.clickText
    // 단추가 그려질 때까지 기다렸다가 스크립트로 누른다, 위에 덮인 안내창이 클릭을 삼키지 못하게
    await page.waitForFunction(
      (t: string) => Array.from(document.querySelectorAll('button')).some((b) => (b.textContent ?? '').includes(t) && !b.disabled),
      { timeout: VISIT_TIMEOUT_MS }, label,
    )
    await page.evaluate((t: string) => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes(t) && !x.disabled)
      b?.click()
    }, label)
  }
  await page.waitForSelector(v.readySelector, { visible: true, timeout: VISIT_TIMEOUT_MS })
}

/**
 * 자형이 다 붙기 전에 찍으면 **빈칸이 그대로 파일에 박힌다.**
 * `domcontentloaded` 는 마크업만 보고 끝난다 — 얹은 woff2 는 그 뒤에 해독된다.
 */
async function waitForFonts(page: Page): Promise<void> {
  try { await page.evaluate(() => document.fonts.ready.then(() => undefined)) } catch { /* noop */ }
}

/**
 * 문서를 PDF 또는 PNG 바이트로. 실패는 **던진다** — 창구마다 남길 자리와 사람에게 할 말이
 * 달라서, 여기서 삼키면 그 둘을 못 고른다.
 */
export async function renderDocument(opts: RenderOptions): Promise<Uint8Array> {
  if (!opts.html === !opts.visit) throw new Error('renderDocument: html 과 visit 중 하나만 준다')
  const { launchOptions } = await import('../security/headless-fetch.ts')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null
  try {
    const puppeteer = (await import('puppeteer-core')).default
    const opt = await launchOptions()
    browser = await puppeteer.launch({ args: opt.args, executablePath: opt.executablePath, headless: opt.headless })
    const page = await browser.newPage()
    if (opts.visit) {
      // 앱 화면은 넓은 창에서 연다, 좁으면 화면 전용 반응형 규칙이 걸린다
      await page.setViewport({ width: 1280, height: 1120, deviceScaleFactor: 2 })
      await openVisit(page, opts.visit)
    } else {
      if (opts.format === 'png') {
        // 문서 폭 고정 + 레티나(2x)로 선명한 이미지
        await page.setViewport({ width: opts.width ?? 760, height: 1120, deviceScaleFactor: 2 })
      }
      await page.setContent(opts.html, { waitUntil: 'domcontentloaded' })
    }
    // 자형 고르기는 실제로 그려진 글자를 본다. visit 은 화면이 다 그려진 뒤에야 글자를 안다
    const text = opts.visit ? String(await page.content()) : (opts.html ?? '')
    const fontCss = await buildKoreanFontCss(text, opts.route)
    if (fontCss) await page.addStyleTag({ content: fontCss })
    await waitForFonts(page)

    if (opts.visit) {
      // 자형이 붙으면 줄바꿈이 바뀌고 미리보기가 다시 잰다, 그 재기가 끝난 뒤에 찍는다
      await new Promise((r) => setTimeout(r, FIT_SETTLE_MS))
      const cls = opts.visit.bodyClass
      if (cls) await page.evaluate((c: string) => document.body.classList.add(c), cls)
      // 파일은 종이다, 인쇄 규칙(보일 것만 남기기, 종이 폭 210mm)으로 그린다
      await page.emulateMediaType('print')
    }

    if (opts.format === 'png') {
      // 지정한 자리만 잘라 찍어 내용에 딱 맞춘다(하단 여백 제거)
      const el = opts.clip ? await page.$(opts.clip) : null
      if (el && opts.page !== undefined) {
        const box = await el.boundingBox()
        const cut = box ? pageClipY(box.height, box.width, opts.page) : null
        if (!box || !cut) throw new PageOutOfRange(opts.page, box ? pageSlices(box.height, box.width).count : 0)
        return await page.screenshot({
          type: 'png', captureBeyondViewport: true,
          clip: { x: box.x, y: box.y + cut.y, width: box.width, height: cut.height },
        })
      }
      return el ? await el.screenshot({ type: 'png' }) : await page.screenshot({ fullPage: true, type: 'png' })
    }
    const m = opts.pdfMargin ?? '24px'
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: m, bottom: m, left: m, right: m } })
  } finally {
    try { await browser?.close() } catch { /* noop */ }
  }
}
