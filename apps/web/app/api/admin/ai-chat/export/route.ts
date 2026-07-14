import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { conversationToMarkdown, sanitizeFilename } from '@/lib/ai-chat/export'
import type { AiChatCitation } from '@/types/database'

export const runtime = 'nodejs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminDb = any

/**
 * GET /api/admin/ai-chat/export?c=<conversationId> (04 §6-1 / S3 §5-1)
 * admin 인가 + owner 검증 → 메시지 asc 로드 → conversationToMarkdown(KST) → .md 첨부 다운로드.
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

  const markdown = conversationToMarkdown(
    {
      title: conversation.title,
      provider: conversation.provider,
      model: conversation.model,
      createdAt: conversation.created_at,
    },
    messages,
  )

  // 파일명: 유니코드 보존 filename* + ASCII 폴백 filename(비ASCII → '_')
  const base = sanitizeFilename(conversation.title)
  const asciiFallback = base.replace(/[^\x20-\x7e]/g, '_').replace(/_+/g, '_') || 'conversation'
  const encoded = encodeURIComponent(`${base}.md`)
  const disposition = `attachment; filename="${asciiFallback}.md"; filename*=UTF-8''${encoded}`

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': disposition,
      'Cache-Control': 'no-store',
    },
  })
}
