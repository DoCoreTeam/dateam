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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any

export interface RenderOptions {
  /** 구울 문서. 완성된 HTML 문자열이며 외부 URL 을 안 연다(SSRF 무관). */
  html: string
  format: 'pdf' | 'png'
  /** 실패를 어디서 기록할지 — 자형을 못 읽었을 때 남길 자리 이름 */
  route: string
  /** png 일 때 이 선택자만 잘라 찍는다. 없으면 문서 전체. */
  clip?: string
  /** png 일 때의 문서 폭. pdf 는 A4 고정이라 안 쓴다. */
  width?: number
  /** pdf 여백. 창구마다 다르게 잡아 온 값이라 넘겨받는다. */
  pdfMargin?: string
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
  const { launchOptions } = await import('../security/headless-fetch.ts')
  const fontCss = await buildKoreanFontCss(opts.html, opts.route)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null
  try {
    const puppeteer = (await import('puppeteer-core')).default
    const opt = await launchOptions()
    browser = await puppeteer.launch({ args: opt.args, executablePath: opt.executablePath, headless: opt.headless })
    const page = await browser.newPage()
    if (opts.format === 'png') {
      // 문서 폭 고정 + 레티나(2x)로 선명한 이미지
      await page.setViewport({ width: opts.width ?? 760, height: 1120, deviceScaleFactor: 2 })
    }
    await page.setContent(opts.html, { waitUntil: 'domcontentloaded' })
    if (fontCss) await page.addStyleTag({ content: fontCss })
    await waitForFonts(page)

    if (opts.format === 'png') {
      // 지정한 자리만 잘라 찍어 내용에 딱 맞춘다(하단 여백 제거)
      const el = opts.clip ? await page.$(opts.clip) : null
      return el ? await el.screenshot({ type: 'png' }) : await page.screenshot({ fullPage: true, type: 'png' })
    }
    const m = opts.pdfMargin ?? '24px'
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: m, bottom: m, left: m, right: m } })
  } finally {
    try { await browser?.close() } catch { /* noop */ }
  }
}
