import { NextRequest, NextResponse } from 'next/server'
import { canExport } from '@/lib/access/guard'
import { EXPORT_DENIED } from '@/lib/terms'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { conversationToMarkdown, conversationToPlainText, sanitizeFilename } from '@/lib/ai-chat/export'
import type { AiChatCitation } from '@/types/database'

export const runtime = 'nodejs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminDb = any

type ExportFormat = 'md' | 'txt'

function parseFormat(v: string | null): ExportFormat {
  return v === 'txt' ? 'txt' : 'md' // 미지정/미인식 값은 기존 기본값(md) 유지 — 호환
}

/**
 * GET /api/admin/ai-chat/export?c=<conversationId>&format=md|txt (04 §6-1 / S3 §5-1, ④ 포맷 확장)
 * admin 인가 + owner 검증 → 메시지 asc 로드 → conversationToMarkdown/PlainText(KST) → 첨부 다운로드.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  /**
   * 값이 파일로 나간다 — **내보내기 판정을 지난다** (LOOP.md 7절 S2 · I10a).
   *
   * 관리자 창구라 지금은 관리자만 부르지만, 그 사실이 이 창구의 보증은 아니다.
   * 표면이 열리는 순간 이 창구도 함께 열린다 — 그때 막을 자리가 여기여야 한다.
   */
  if (!(await canExport('/ai'))) {
    return NextResponse.json({ error: EXPORT_DENIED }, { status: 403 })
  }
  const user = auth.user

  const conversationId = req.nextUrl.searchParams.get('c') ?? ''
  if (!conversationId) {
    return NextResponse.json({ error: '대화 ID가 필요합니다' }, { status: 400 })
  }
  const format = parseFormat(req.nextUrl.searchParams.get('format'))

  const admin = createAdminClient() as AdminDb

  // 소유 검증 (admin + owner)
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

  // 메시지 asc — 실패(빈 error 행) 제외
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

  const conversationMeta = {
    title: conversation.title,
    provider: conversation.provider,
    model: conversation.model,
    createdAt: conversation.created_at,
  }
  const body = format === 'txt'
    ? conversationToPlainText(conversationMeta, messages)
    : conversationToMarkdown(conversationMeta, messages)
  const contentType = format === 'txt' ? 'text/plain; charset=utf-8' : 'text/markdown; charset=utf-8'

  // 파일명: 유니코드 보존 filename* + ASCII 폴백 filename(비ASCII → '_')
  const base = sanitizeFilename(conversation.title)
  const asciiFallback = base.replace(/[^\x20-\x7e]/g, '_').replace(/_+/g, '_') || 'conversation'
  const encoded = encodeURIComponent(`${base}.${format}`)
  const disposition = `attachment; filename="${asciiFallback}.${format}"; filename*=UTF-8''${encoded}`

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': disposition,
      'Cache-Control': 'no-store',
    },
  })
}
