import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { logTokenUsage } from '@/lib/token-logger'
import { getProvider, getProviderConfig } from '@/lib/ai-chat/registry'
import type { ChatTurn } from '@/lib/ai-chat/provider'
import { autoTitle } from '@/app/admin/ai-chat/actions'
import type { AiChatConversation, AiChatMessage } from '@/types/database'

const MAX_CONTENT_LEN = 32000
const MAX_HISTORY_TURNS = 40

// provider/model 화이트리스트·형식 방어 (M-2)
const ALLOWED_PROVIDERS = ['gemini', 'claude', 'openai'] as const
const MODEL_RE = /^[\w.:\-]{1,64}$/

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

async function readMeta(adminClient: AdminClient): Promise<Record<string, unknown>> {
  const { data } = await adminClient
    .from('org_content')
    .select('value')
    .eq('key', 'META')
    .single()
  return (data?.value as Record<string, unknown>) ?? {}
}

function sse(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`)
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const user = auth.user

  let body: { conversationId?: unknown; content?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!conversationId) {
    return NextResponse.json({ error: '대화 ID가 필요합니다' }, { status: 400 })
  }
  if (!content) {
    return NextResponse.json({ error: '메시지를 입력해주세요' }, { status: 400 })
  }
  if (content.length > MAX_CONTENT_LEN) {
    return NextResponse.json(
      { error: `메시지가 너무 깁니다 (${MAX_CONTENT_LEN}자 이하)` },
      { status: 400 },
    )
  }

  const adminClient: AdminClient = createAdminClient()

  // 소유 검증 (admin + owner)
  const { data: convRow } = await adminClient
    .from('ai_conversations')
    .select('id, user_id, provider, model, system_prompt, title')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .single()
  const conversation = convRow as Pick<
    AiChatConversation,
    'id' | 'user_id' | 'provider' | 'model' | 'system_prompt' | 'title'
  > | null
  if (!conversation) {
    return NextResponse.json({ error: '대화를 찾을 수 없습니다' }, { status: 404 })
  }

  if (
    !(ALLOWED_PROVIDERS as readonly string[]).includes(conversation.provider) ||
    !MODEL_RE.test(conversation.model)
  ) {
    return NextResponse.json({ error: '유효하지 않은 프로바이더 또는 모델입니다' }, { status: 400 })
  }

  const meta = await readMeta(adminClient)
  const config = getProviderConfig(meta, conversation.provider)
  if (!config) {
    return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다' }, { status: 500 })
  }

  // 사용자 메시지 insert (트리거가 대화 updated_at 갱신)
  await adminClient
    .from('ai_messages')
    .insert({ conversation_id: conversationId, role: 'user', content })

  // 히스토리 로드 (asc) → error is null → 최근 40턴 → ChatTurn[]
  const { data: histRows } = await adminClient
    .from('ai_messages')
    .select('role, content, error')
    .eq('conversation_id', conversationId)
    .is('error', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  const history = (histRows ?? []) as Pick<AiChatMessage, 'role' | 'content'>[]
  const turns: ChatTurn[] = history
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content }))

  const provider = getProvider(conversation.provider)
  const providerName = conversation.provider
  const model = conversation.model
  const isFirstTitle = conversation.title === '새 대화'

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const enqueue = (obj: unknown) => {
        if (!closed) controller.enqueue(sse(obj))
      }

      try {
        const result = await provider.streamChat({
          apiKey: config.apiKey,
          model,
          system: conversation.system_prompt ?? undefined,
          turns,
          signal: req.signal,
          onDelta: (t) => enqueue({ delta: t }),
          onThinking: (t) => enqueue({ thinking: t }),
        })

        // 정상/중단 공통: assistant row insert
        const { data: inserted } = await adminClient
          .from('ai_messages')
          .insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: result.text,
            thinking: result.thinking,
            provider: providerName,
            model,
            prompt_tokens: result.usage.promptTokens,
            output_tokens: result.usage.outputTokens,
            stopped: result.stopped,
          })
          .select('id')
          .single()
        const messageId = (inserted as { id: string } | null)?.id ?? ''

        logTokenUsage({
          userId: user.id,
          feature: 'ai-chat',
          model,
          provider: providerName,
          promptTokens: result.usage.promptTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
        })

        // 자동 제목 (첫 어시스턴트 응답 + 기본 제목일 때만, fire-and-forget)
        if (isFirstTitle && result.text) {
          autoTitle(conversationId).catch(() => {})
        }

        enqueue({ done: true, messageId })
      } catch (err) {
        // 프로바이더 예외 → 원문은 서버 로그, 클라이언트에는 일반화된 메시지만 (M-1)
        console.error('[ai-chat/stream] provider error', err)
        const message = 'AI 응답 생성 실패'
        try {
          await adminClient.from('ai_messages').insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: '',
            provider: providerName,
            model,
            error: message,
          })
        } catch (insertErr) {
          console.error('[ai-chat/stream] error row insert 실패', insertErr)
        }
        enqueue({ done: true, error: message })
      } finally {
        closed = true
        try {
          controller.close()
        } catch {
          // 이미 닫힘
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
