import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { logTokenUsage } from '@/lib/token-logger'
import { getProvider, getProviderConfig } from '@/lib/ai-chat/registry'
import type { ChatTurn, AttachmentInput } from '@/lib/ai-chat/provider'
import { buildActiveThread } from '@/lib/ai-chat/thread'
import {
  attachmentFallbackText,
  MAX_REQUEST_ATTACHMENT_BYTES,
} from '@/lib/ai-chat/attachments'
import { extractDocumentText } from '@/lib/ai-chat/document-extract'
import { retrieveProjectContext, buildProjectSystemBlock } from '@/lib/ai-chat/knowledge'
import { autoTitle } from '@/app/admin/ai-chat/actions'
import type { AiChatConversation, AiChatCitation } from '@/types/database'

export const runtime = 'nodejs' // extractDocumentText(officeparser) + Buffer 사용

const MAX_CONTENT_LEN = 32000
const MAX_HISTORY_TURNS = 40
const BUCKET = 'ai-chat'

// provider/model 화이트리스트·형식 방어 (M-2)
const ALLOWED_PROVIDERS = ['gemini', 'claude', 'openai'] as const
const MODEL_RE = /^[\w.:\-]{1,64}$/
const MODES = ['send', 'regenerate', 'edit'] as const
type StreamMode = (typeof MODES)[number]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

// 활성 스레드 재구성 입력 (buildActiveThread ThreadMsg 충족)
interface MsgRow {
  id: string
  role: 'user' | 'assistant'
  content: string
  error: string | null
  parent_message_id: string | null
  created_at: string
}

interface AttachmentRow {
  id: string
  message_id: string
  storage_path: string
  filename: string
  mime: string
  size_bytes: number
  kind: 'image' | 'pdf' | 'document' | 'other'
}

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

// 전체 메시지 asc 로드 (활성 스레드 재구성용)
async function loadMessages(admin: AdminClient, conversationId: string): Promise<MsgRow[]> {
  const { data } = await admin
    .from('ai_messages')
    .select('id, role, content, error, parent_message_id, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  return (data ?? []) as MsgRow[]
}

// 첨부 1개 → base64. image/pdf=원본 base64, document=추출 텍스트 base64. 실패 시 null.
async function hydrateAttachment(
  admin: AdminClient,
  a: AttachmentRow,
): Promise<AttachmentInput | null> {
  const kind = a.kind
  if (kind !== 'image' && kind !== 'pdf' && kind !== 'document') return null
  const { data: blob, error } = await admin.storage.from(BUCKET).download(a.storage_path)
  if (error || !blob) return null
  const buf = new Uint8Array(await blob.arrayBuffer())
  let dataBase64: string
  if (kind === 'document') {
    let text: string
    try {
      text = await extractDocumentText(buf, a.mime)
    } catch {
      return null
    }
    dataBase64 = Buffer.from(text, 'utf8').toString('base64')
  } else {
    dataBase64 = Buffer.from(buf).toString('base64')
  }
  return { kind, mime: a.mime, filename: a.filename, dataBase64 }
}

// 히스토리 행 → ChatTurn[]: error 제외 → 최근 40턴 → 첨부 하이드레이션(+ vision/총량 가드)
async function buildTurns(
  admin: AdminClient,
  historyRows: MsgRow[],
  visionSupported: boolean,
): Promise<ChatTurn[]> {
  const usable = historyRows.filter((r) => r.error === null).slice(-MAX_HISTORY_TURNS)

  const userIds = usable.filter((r) => r.role === 'user').map((r) => r.id)
  const attByMsg = new Map<string, AttachmentRow[]>()
  if (userIds.length > 0) {
    const { data: attRows } = await admin
      .from('ai_attachments')
      .select('id, message_id, storage_path, filename, mime, size_bytes, kind')
      .in('message_id', userIds)
    for (const a of (attRows ?? []) as AttachmentRow[]) {
      const list = attByMsg.get(a.message_id) ?? []
      list.push(a)
      attByMsg.set(a.message_id, list)
    }
  }

  interface Plan {
    row: MsgRow
    atts: AttachmentRow[]
    fallback: boolean
  }
  const plans: Plan[] = usable.map((r) => ({
    row: r,
    atts: attByMsg.get(r.id) ?? [],
    fallback: false,
  }))

  // vision 3중방어(히스토리): 미지원 프로바이더 → 첨부 있는 턴 전부 fallback 텍스트 대체
  if (!visionSupported) {
    for (const p of plans) if (p.atts.length > 0) p.fallback = true
  }

  // 요청 총량 가드: 원본 합 > 20MB → 오래된 턴부터 fallback 대체 감축
  let total = 0
  for (const p of plans) if (!p.fallback) for (const a of p.atts) total += a.size_bytes
  if (total > MAX_REQUEST_ATTACHMENT_BYTES) {
    for (const p of plans) {
      if (total <= MAX_REQUEST_ATTACHMENT_BYTES) break
      if (p.fallback || p.atts.length === 0) continue
      for (const a of p.atts) total -= a.size_bytes
      p.fallback = true
    }
  }

  const turns: ChatTurn[] = []
  for (const p of plans) {
    if (p.atts.length === 0) {
      turns.push({ role: p.row.role, content: p.row.content })
      continue
    }
    if (p.fallback) {
      const named: AttachmentInput[] = p.atts.map((a) => ({
        kind: 'document',
        mime: a.mime,
        filename: a.filename,
        dataBase64: '',
      }))
      const prefix = attachmentFallbackText(named)
      turns.push({ role: p.row.role, content: `${prefix}\n${p.row.content}`.trim() })
      continue
    }
    const inputs: AttachmentInput[] = []
    for (const a of p.atts) {
      const input = await hydrateAttachment(admin, a)
      if (input) inputs.push(input)
    }
    turns.push(
      inputs.length > 0
        ? { role: p.row.role, content: p.row.content, attachments: inputs }
        : { role: p.row.role, content: p.row.content },
    )
  }
  return turns
}

// 첨부 연결(send/edit): message_id null·본인 소유·해당 대화만 → 새 user id로 update.
// affected ≠ length → false (호출측 롤백).
async function linkAttachments(
  admin: AdminClient,
  attachmentIds: string[],
  userId: string,
  conversationId: string,
  messageId: string,
): Promise<boolean> {
  if (attachmentIds.length === 0) return true
  const { data, error } = await admin
    .from('ai_attachments')
    .update({ message_id: messageId })
    .in('id', attachmentIds)
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
    .is('message_id', null)
    .select('id')
  if (error) return false
  return ((data ?? []) as { id: string }[]).length === attachmentIds.length
}

// user 메시지 삽입 롤백: 연결된 첨부 message_id 되돌린 뒤 메시지 삭제(첨부 cascade 소실 방지)
async function rollbackUserMessage(admin: AdminClient, messageId: string): Promise<void> {
  await admin.from('ai_attachments').update({ message_id: null }).eq('message_id', messageId)
  await admin.from('ai_messages').delete().eq('id', messageId)
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const user = auth.user

  let body: {
    conversationId?: unknown
    mode?: unknown
    content?: unknown
    attachmentIds?: unknown
    editedMessageId?: unknown
    tools?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
  if (!conversationId) {
    return NextResponse.json({ error: '대화 ID가 필요합니다' }, { status: 400 })
  }

  const mode: StreamMode =
    typeof body.mode === 'string' && (MODES as readonly string[]).includes(body.mode)
      ? (body.mode as StreamMode)
      : 'send'

  const content = typeof body.content === 'string' ? body.content.trim() : ''

  let attachmentIds: string[] = []
  if (body.attachmentIds !== undefined) {
    if (!Array.isArray(body.attachmentIds) || body.attachmentIds.some((x) => typeof x !== 'string')) {
      return NextResponse.json({ error: '첨부 형식 오류' }, { status: 400 })
    }
    attachmentIds = body.attachmentIds as string[]
  }
  // regenerate 는 신규 첨부 무의미 — 무시
  if (mode === 'regenerate') attachmentIds = []

  const editedMessageId = typeof body.editedMessageId === 'string' ? body.editedMessageId : ''

  // tools 파싱 (S3) — { webSearch?: boolean }. capabilities.tools=false 프로바이더에 지정 시 400(아래 provider 로드 후)
  const webSearchRequested =
    typeof body.tools === 'object' &&
    body.tools !== null &&
    (body.tools as { webSearch?: unknown }).webSearch === true
  const toolsOption = webSearchRequested ? { webSearch: true } : undefined

  // 콘텐츠 검증: send·edit 는 trim≥1 또는 attachmentIds≥1
  if (mode === 'send' || mode === 'edit') {
    if (!content && attachmentIds.length === 0) {
      return NextResponse.json({ error: '메시지를 입력해주세요' }, { status: 400 })
    }
    if (content.length > MAX_CONTENT_LEN) {
      return NextResponse.json(
        { error: `메시지가 너무 깁니다 (${MAX_CONTENT_LEN}자 이하)` },
        { status: 400 },
      )
    }
  }
  if (mode === 'edit' && !editedMessageId) {
    return NextResponse.json({ error: '편집 대상 메시지가 필요합니다' }, { status: 400 })
  }

  const adminClient: AdminClient = createAdminClient()

  // 소유 검증 (admin + owner)
  const { data: convRow } = await adminClient
    .from('ai_conversations')
    .select('id, user_id, provider, model, system_prompt, title, project_id')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .single()
  const conversation = convRow as Pick<
    AiChatConversation,
    'id' | 'user_id' | 'provider' | 'model' | 'system_prompt' | 'title' | 'project_id'
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

  const provider = getProvider(conversation.provider)
  const visionSupported = provider.capabilities.vision

  // vision 3중방어(스트림 API): 신규 첨부인데 미지원 → 400
  if (attachmentIds.length > 0 && !visionSupported) {
    return NextResponse.json(
      { error: '현재 프로바이더는 첨부를 지원하지 않습니다' },
      { status: 400 },
    )
  }

  // 툴 게이팅(S3 §4-3): web_search 요청인데 capabilities.tools=false → 400
  if (webSearchRequested && provider.capabilities.tools === false) {
    return NextResponse.json(
      { error: '현재 프로바이더는 웹 검색을 지원하지 않습니다' },
      { status: 400 },
    )
  }

  // ── 모드별 히스토리 확정 (스트림 진입 전 동기 처리 — 400 응답 가능하게) ──
  let historyRows: MsgRow[]
  let regenTargetId: string | null = null

  if (mode === 'send') {
    const { data: inserted } = await adminClient
      .from('ai_messages')
      .insert({ conversation_id: conversationId, role: 'user', content })
      .select('id')
      .single()
    const newUserId = (inserted as { id: string } | null)?.id ?? ''
    if (!newUserId) {
      return NextResponse.json({ error: '메시지 저장 실패' }, { status: 500 })
    }
    if (attachmentIds.length > 0) {
      const ok = await linkAttachments(adminClient, attachmentIds, user.id, conversationId, newUserId)
      if (!ok) {
        await rollbackUserMessage(adminClient, newUserId)
        return NextResponse.json({ error: '첨부 연결에 실패했습니다' }, { status: 400 })
      }
    }
    historyRows = buildActiveThread(await loadMessages(adminClient, conversationId))
  } else if (mode === 'edit') {
    const active = buildActiveThread(await loadMessages(adminClient, conversationId))
    const target = active.find((m) => m.id === editedMessageId && m.role === 'user')
    if (!target) {
      return NextResponse.json({ error: '편집할 메시지를 찾을 수 없습니다' }, { status: 400 })
    }
    const { data: inserted } = await adminClient
      .from('ai_messages')
      .insert({
        conversation_id: conversationId,
        role: 'user',
        content,
        parent_message_id: editedMessageId,
      })
      .select('id')
      .single()
    const newUserId = (inserted as { id: string } | null)?.id ?? ''
    if (!newUserId) {
      return NextResponse.json({ error: '메시지 저장 실패' }, { status: 500 })
    }
    if (attachmentIds.length > 0) {
      const ok = await linkAttachments(adminClient, attachmentIds, user.id, conversationId, newUserId)
      if (!ok) {
        await rollbackUserMessage(adminClient, newUserId)
        return NextResponse.json({ error: '첨부 연결에 실패했습니다' }, { status: 400 })
      }
    }
    historyRows = buildActiveThread(await loadMessages(adminClient, conversationId))
  } else {
    // regenerate: 활성 스레드 마지막이 assistant 여야 함
    const active = buildActiveThread(await loadMessages(adminClient, conversationId))
    const last = active[active.length - 1]
    if (!last || last.role !== 'assistant') {
      return NextResponse.json({ error: '재생성할 응답이 없습니다' }, { status: 400 })
    }
    regenTargetId = last.id
    historyRows = active.slice(0, -1)
  }

  const turns = await buildTurns(adminClient, historyRows, visionSupported)

  // ── system 합성 (S3 §3-3): [1] system_prompt → [2] project.instructions → [3] 프로젝트 지식 top-k ──
  // project_id 있고 지식 ≥1건일 때만 [3] 조회. 임베딩 실패/0히트 → 블록 생략(응답 비차단).
  let composedSystem = conversation.system_prompt ?? ''
  if (conversation.project_id) {
    const { data: projRow } = await adminClient
      .from('ai_projects')
      .select('instructions')
      .eq('id', conversation.project_id)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .single()
    const instructions = (projRow as { instructions: string | null } | null)?.instructions ?? null

    let hits: { content: string; source: string }[] = []
    const { count: knowledgeCount } = await adminClient
      .from('ai_project_knowledge')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', conversation.project_id)
    if ((knowledgeCount ?? 0) > 0) {
      const geminiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
      // 쿼리 = 직전 사용자 메시지 원문(첨부 제외 = ChatTurn.content)
      const lastUser = [...turns].reverse().find((t) => t.role === 'user')
      const query = lastUser?.content ?? ''
      try {
        const retrieved = await retrieveProjectContext(
          conversation.project_id,
          query,
          user.id,
          geminiKey,
        )
        hits = retrieved.map((r) => ({ content: r.content, source: r.source }))
      } catch {
        hits = []
      }
    }
    // buildProjectSystemBlock = [2]+[3] (instructions·지식 모두 비면 '')
    const block = buildProjectSystemBlock(instructions, hits)
    composedSystem = [composedSystem, block].filter((s) => s && s.trim()).join('\n\n')
  }
  const systemForStream = composedSystem.trim() ? composedSystem : undefined

  const providerName = conversation.provider
  const model = conversation.model
  const isFirstTitle = conversation.title === '새 대화'

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const enqueue = (obj: unknown) => {
        if (!closed) controller.enqueue(sse(obj))
      }

      // 수집 citations(중복 url dedupe는 호출측 — 저장·SSE 전송 공용)
      const citations: AiChatCitation[] = []
      const seenUrls = new Set<string>()
      const collectCitation = (c: AiChatCitation): boolean => {
        if (!c || typeof c.url !== 'string' || !c.url || seenUrls.has(c.url)) return false
        seenUrls.add(c.url)
        citations.push(c)
        return true
      }

      try {
        const result = await provider.streamChat({
          apiKey: config.apiKey,
          model,
          system: systemForStream,
          turns,
          tools: toolsOption,
          signal: req.signal,
          onDelta: (t) => enqueue({ delta: t }),
          onThinking: (t) => enqueue({ thinking: t }),
          onCitation: (c) => {
            if (collectCitation(c)) enqueue({ citation: c })
          },
          onToolStatus: (s) => enqueue({ toolStatus: s }),
        })

        // 프로바이더가 result.citations로만 보고한 분도 병합(dedupe)
        for (const c of result.citations ?? []) collectCitation(c)
        const citationsForSave = citations.length > 0 ? citations : null

        let messageId = ''
        if (mode === 'regenerate' && regenTargetId) {
          // 기존 assistant row update 치환 (created_at 유지, feedback 리셋)
          const { data: updated } = await adminClient
            .from('ai_messages')
            .update({
              content: result.text,
              thinking: result.thinking,
              provider: providerName,
              model,
              prompt_tokens: result.usage.promptTokens,
              output_tokens: result.usage.outputTokens,
              stopped: result.stopped,
              error: null,
              feedback: null,
              citations: citationsForSave,
            })
            .eq('id', regenTargetId)
            .eq('conversation_id', conversationId)
            .select('id')
            .single()
          messageId = (updated as { id: string } | null)?.id ?? regenTargetId
        } else {
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
              citations: citationsForSave,
            })
            .select('id')
            .single()
          messageId = (inserted as { id: string } | null)?.id ?? ''
        }

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
          if (mode === 'regenerate' && regenTargetId) {
            // 재생성 실패 — 기존 assistant 응답을 **덮어쓰지 않고 보존**(§5-1 "실패 시 이전 내용 복원").
            // 클라이언트가 done+error 수신 후 재조회하면 보존된 원본이 그대로 복원된다.
          } else {
            await adminClient.from('ai_messages').insert({
              conversation_id: conversationId,
              role: 'assistant',
              content: '',
              provider: providerName,
              model,
              error: message,
            })
          }
        } catch (insertErr) {
          console.error('[ai-chat/stream] error row 저장 실패', insertErr)
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
