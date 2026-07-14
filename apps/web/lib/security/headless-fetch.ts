// lib/security/headless-fetch.ts — JS 렌더 사이트 URL을 헤드리스 Chromium으로 렌더해 HTML 확보.
// 왜: nebius.com/prices 등은 클라이언트(JS) 렌더라 일반 fetch는 빈 껍데기만 받는다(1484B). 가격표가 HTML에 없음.
// 정책: 평소엔 일반 fetch(호출부 하이브리드), 빈손일 때만 렌더. SSRF는 assertSafeUrl로 초기 URL 게이트.
// 환경: Vercel/Lambda = @sparticuz/chromium, 로컬 = 시스템 Chrome. 실패는 throw 안 하고 '' 반환(우아한 폴백 → 회귀0).
import { assertSafeUrl } from './safe-fetch'

const RENDER_TIMEOUT_MS = 22_000
const SETTLE_MS = 1_500
const RENDER_MAX_CHARS = 3_000_000

function isServerless(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV)
}

// Vercel/Lambda면 @sparticuz, 로컬이면 시스템 Chrome(LOCAL_CHROME_PATH로 오버라이드 가능).
// export: PDF export 라우트(app/api/admin/ai-chat/export-pdf) 등 puppeteer-core 기반 다른 소비처가
// 동일 launch 분기(서버리스/로컬/프로덕션 non-serverless 차단)를 재사용(복붙 금지, SSOT).
export async function launchOptions(): Promise<{ args: string[]; executablePath: string; headless: boolean }> {
  if (isServerless()) {
    // 동적 import — 로컬/빌드 타임에 @sparticuz 로딩 부담 회피
    const mod = await import('@sparticuz/chromium')
    const chromium = (mod.default ?? mod) as unknown as {
      args: string[]; executablePath: (p?: string) => Promise<string>
    }
    return { args: chromium.args, executablePath: await chromium.executablePath(), headless: true }
  }
  // 운영(production) 비-서버리스 환경에서 --no-sandbox + 로컬 바이너리 실행은 위험 → 차단(VERCEL env 누락 self-host 오인 방지).
  if (process.env.NODE_ENV === 'production') {
    throw new Error('headless render disabled: production non-serverless environment')
  }
  const local = process.env.LOCAL_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  return { args: ['--no-sandbox', '--disable-setuid-sandbox'], executablePath: local, headless: true }
}

/**
 * JS 렌더 후 HTML 반환. 실패/차단/타임아웃 시 '' (호출부가 일반 fetch 결과로 폴백).
 * SSRF: 초기 URL을 assertSafeUrl로 검증(사설망/비허용 스킴 차단). 통과 못하면 '' 반환(렌더 안 함).
 */
export async function renderUrlHtml(url: string): Promise<string> {
  try { await assertSafeUrl(url) } catch { return '' }  // 안전하지 않은 URL → 렌더 안 함

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null
  try {
    const puppeteer = (await import('puppeteer-core')).default
    const opt = await launchOptions()
    browser = await puppeteer.launch({ args: opt.args, executablePath: opt.executablePath, headless: opt.headless })
    const page = await browser.newPage()
    // SSRF 하위리소스 방어(DC-SEC HIGH): 초기 URL뿐 아니라 브라우저가 따라가는 모든 요청(리다이렉트·XHR·iframe)을
    // assertSafeUrl로 재검증해 사설망/메타데이터(169.254.169.254 등) 접근을 abort. DNS rebinding도 매요청 resolve로 차단.
    await page.setRequestInterception(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page.on('request', async (req: any) => {
      try { await assertSafeUrl(req.url()); await req.continue() } catch { try { await req.abort() } catch { /* noop */ } }
    })
    page.setDefaultNavigationTimeout(RENDER_TIMEOUT_MS)
    // 일반 브라우저 UA — Googlebot/봇 UA는 봇 차단 셸을 받는다(실측: nebius가 1.4KB 차단셸 반환).
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
    // networkidle2로 JS 표 렌더 대기. 무한 폴링 사이트 대비 timeout으로 캡 + goto 실패해도 부분 content 읽음.
    await page.goto(url, { waitUntil: 'networkidle2', timeout: RENDER_TIMEOUT_MS }).catch(() => { /* 부분 렌더라도 진행 */ })
    await new Promise((r) => setTimeout(r, SETTLE_MS))
    const html = await page.content()
    return typeof html === 'string' ? html.slice(0, RENDER_MAX_CHARS) : ''
  } catch {
    return ''
  } finally {
    try { await browser?.close() } catch { /* noop */ }
  }
}
