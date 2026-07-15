import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { conversationToHtmlDocument, sanitizeFilename } from '@/lib/ai-chat/export'
import { launchOptions } from '@/lib/security/headless-fetch'

export const runtime = 'nodejs'
export const maxDuration = 30

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PuppeteerBrowser = any

const MAX_SECTIONS = 200
const MAX_TEXT_CHARS = 50_000
const MAX_TITLE_CHARS = 100

interface Section {
  itemText: string
  resultText: string
}

/**
 * POST /api/admin/ai-chat/analyze-export-pdf (§E 목록 심층분석 4번째 포맷 — PDF)
 * export-pdf 라우트(대화 DB 조회 기반)와 달리, 분석 결과는 클라가 이미 조립한 항목별 결과를
 * 요청 본문으로 받아 렌더한다(md/txt/docx export와 동일하게 클라 상태를 소스로 사용).
 * conversationToHtmlDocument는 escapeHtml로 이스케이프하므로 마크업 주입 없음.
 * SSRF 우려 없음: 외부 URL을 로드하지 않고 page.setContent로 로컬 문자열만 렌더한다.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: { title?: string; sections?: Section[]; synthText?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 })
  }

  const sections = Array.isArray(body.sections) ? body.sections : []
  if (sections.length === 0 || sections.length > MAX_SECTIONS) {
    return NextResponse.json({ error: '내보낼 분석 결과가 없습니다' }, { status: 400 })
  }
  const valid = sections.every(
    (s) =>
      typeof s?.itemText === 'string' &&
      typeof s?.resultText === 'string' &&
      s.itemText.length <= MAX_TEXT_CHARS &&
      s.resultText.length <= MAX_TEXT_CHARS,
  )
  if (!valid) return NextResponse.json({ error: '요청 형식이 올바르지 않습니다' }, { status: 400 })

  const title = (typeof body.title === 'string' ? body.title : '목록 심층분석').slice(0, MAX_TITLE_CHARS) || '목록 심층분석'
  const nowIso = new Date().toISOString()

  const messages = sections.flatMap((s) => [
    { role: 'user' as const, content: s.itemText, createdAt: nowIso },
    { role: 'assistant' as const, content: s.resultText, createdAt: nowIso },
  ])
  if (typeof body.synthText === 'string' && body.synthText.trim()) {
    messages.push({
      role: 'assistant' as const,
      content: `[종합 인사이트]\n${body.synthText.trim().slice(0, MAX_TEXT_CHARS)}`,
      createdAt: nowIso,
    })
  }

  const html = conversationToHtmlDocument({ title, provider: 'gemini', model: '', createdAt: nowIso }, messages)

  let browser: PuppeteerBrowser = null
  let pdf: Uint8Array
  try {
    const puppeteer = (await import('puppeteer-core')).default
    const opt = await launchOptions()
    browser = await puppeteer.launch({ args: opt.args, executablePath: opt.executablePath, headless: opt.headless })
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
    pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' } })
  } catch {
    return NextResponse.json({ error: 'PDF 생성 중 오류가 발생했습니다' }, { status: 500 })
  } finally {
    try {
      await browser?.close()
    } catch {
      /* noop */
    }
  }

  const base = sanitizeFilename(title)
  const asciiFallback = base.replace(/[^\x20-\x7e]/g, '_').replace(/_+/g, '_') || 'analysis'
  const encoded = encodeURIComponent(`${base}.pdf`)
  const disposition = `attachment; filename="${asciiFallback}.pdf"; filename*=UTF-8''${encoded}`

  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': disposition,
      'Cache-Control': 'no-store',
    },
  })
}
