import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { conversationToHtmlDocument, sanitizeFilename } from '@/lib/ai-chat/export'
import { launchOptions } from '@/lib/security/headless-fetch'
import type { AiChatCitation } from '@/types/database'

export const runtime = 'nodejs'
export const maxDuration = 30

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminDb = any

/**
 * GET /api/admin/ai-chat/export-pdf?c=<conversationId> (④ 다운로드 포맷 확장 — PDF)
 * admin 인가 + owner 검증 → conversationToHtmlDocument(내부 생성 HTML, 사용자 입력 없음)를
 * puppeteer-core + @sparticuz/chromium으로 렌더 → PDF 첨부 다운로드.
 * SSRF 우려 없음: 외부 URL을 로드하지 않고 page.setContent로 로컬 문자열만 렌더한다.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const user = auth.user

  const conversationId = req.nextUrl.searchParams.get('c') ?? ''
  if (!conversationId) {
    return NextResponse.json({ error: '대화 ID가 필요합니다' }, { status: 400 })
  }

  const admin = createAdminClient() as AdminDb

  const { data: conv } = await admin
    .from('ai_conversations')
    .select('id, title, provider, model, created_at')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .single()
  if (!conv) {
    return NextResponse.json({ error: '대화를 찾을 수 없습니다' }, { status: 404 })
  }
  const conversation = conv as {
    title: string
    provider: string
    model: string
    created_at: string
  }

  const { data: msgData } = await admin
    .from('ai_messages')
    .select('role, content, created_at, citations')
    .eq('conversation_id', conversationId)
    .is('error', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  const rows = (msgData ?? []) as {
    role: 'user' | 'assistant'
    content: string
    created_at: string
    citations: AiChatCitation[] | null
  }[]

  const messages = rows.map((m) => ({
    role: m.role,
    content: m.content,
    createdAt: m.created_at,
    citations: Array.isArray(m.citations)
      ? m.citations.map((c) => ({ url: c.url, title: c.title }))
      : undefined,
  }))

  const html = conversationToHtmlDocument(
    {
      title: conversation.title,
      provider: conversation.provider,
      model: conversation.model,
      createdAt: conversation.created_at,
    },
    messages,
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null
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
    try { await browser?.close() } catch { /* noop */ }
  }

  const base = sanitizeFilename(conversation.title)
  const asciiFallback = base.replace(/[^\x20-\x7e]/g, '_').replace(/_+/g, '_') || 'conversation'
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
