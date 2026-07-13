'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logTokenUsage } from '@/lib/token-logger'
import { getProvider, getProviderConfig } from '@/lib/ai-chat/registry'
import type { AiChatProviderId, AiChatConversation, AiChatMessage } from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

const CONV_COLUMNS =
  'id, user_id, title, provider, model, system_prompt, pinned, created_at, updated_at, deleted_at'
const MSG_COLUMNS =
  'id, conversation_id, role, content, thinking, provider, model, prompt_tokens, output_tokens, stopped, error, created_at'

// provider/model 화이트리스트·형식 검증 (M-2)
const ALLOWED_PROVIDERS: readonly AiChatProviderId[] = ['gemini', 'claude', 'openai']
const MODEL_RE = /^[\w.:\-]{1,64}$/

function isValidProvider(p: unknown): p is AiChatProviderId {
  return typeof p === 'string' && (ALLOWED_PROVIDERS as readonly string[]).includes(p)
}
function isValidModel(m: unknown): m is string {
  return typeof m === 'string' && MODEL_RE.test(m)
}

interface Ctx {
  userId: string
  admin: AdminClient
}

async function getCtx(): Promise<Ctx | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const admin: AdminClient = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()
  if (profile?.role !== 'admin') return null
  return { userId: user.id, admin }
}

async function readMeta(admin: AdminClient): Promise<Record<string, unknown>> {
  const { data } = await admin.from('org_content').select('value').eq('key', 'META').single()
  return (data?.value as Record<string, unknown>) ?? {}
}

// 소유 검증: 활성 대화가 본인 소유인지
async function ownsConversation(
  admin: AdminClient,
  userId: string,
  id: string,
): Promise<boolean> {
  const { data } = await admin
    .from('ai_conversations')
    .select('id')
    .eq('id', id)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .single()
  return !!data
}

// ── Create ──
export async function createConversation(input: {
  provider: AiChatProviderId
  model: string
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  if (!isValidProvider(input.provider)) return { ok: false, error: '유효하지 않은 프로바이더' }

  const model = input.model?.trim()
  if (!model) return { ok: false, error: '모델을 선택해주세요' }
  if (!isValidModel(model)) return { ok: false, error: '유효하지 않은 모델' }

  const meta = await readMeta(ctx.admin)
  if (!getProviderConfig(meta, input.provider)) {
    return { ok: false, error: '해당 프로바이더의 AI 키가 설정되지 않았습니다' }
  }

  const { data, error } = await ctx.admin
    .from('ai_conversations')
    .insert({ user_id: ctx.userId, provider: input.provider, model })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: '대화 생성 중 오류가 발생했습니다' }

  revalidatePath('/admin/ai-chat')
  return { ok: true, id: (data as { id: string }).id }
}

// ── Read: 목록 (핀 우선 → updated_at desc, 커서 페이지네이션) ──
export async function listConversations(input?: {
  cursor?: string
  limit?: number
}): Promise<{
  ok: boolean
  items?: AiChatConversation[]
  nextCursor?: string | null
  error?: string
}> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  const limit = Math.min(Math.max(input?.limit ?? 30, 1), 50)

  let q = ctx.admin
    .from('ai_conversations')
    .select(CONV_COLUMNS)
    .eq('user_id', ctx.userId)
    .is('deleted_at', null)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(limit + 1)
  if (input?.cursor) q = q.lt('updated_at', input.cursor)

  const { data, error } = await q
  if (error) return { ok: false, error: '목록 조회 중 오류가 발생했습니다' }

  const rows = (data ?? []) as AiChatConversation[]
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? items[items.length - 1].updated_at : null
  return { ok: true, items, nextCursor }
}

// ── Read: 메시지 (최신 페이지부터 위로 로드) ──
export async function getMessages(input: {
  conversationId: string
  before?: string
  limit?: number
}): Promise<{
  ok: boolean
  items?: AiChatMessage[]
  nextCursor?: string | null
  error?: string
}> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }
  if (!(await ownsConversation(ctx.admin, ctx.userId, input.conversationId))) {
    return { ok: false, error: '대화를 찾을 수 없습니다' }
  }

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)

  let q = ctx.admin
    .from('ai_messages')
    .select(MSG_COLUMNS)
    .eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (input.before) q = q.lt('created_at', input.before)

  const { data, error } = await q
  if (error) return { ok: false, error: '메시지 조회 중 오류가 발생했습니다' }

  const rows = (data ?? []) as AiChatMessage[]
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? page[page.length - 1].created_at : null
  // desc 조회분을 asc로 반전해 반환 (화면 표시 순서)
  const items = [...page].reverse()
  return { ok: true, items, nextCursor }
}

// ── Update ──
export async function renameConversation(
  id: string,
  title: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  const trimmed = title?.trim() ?? ''
  if (trimmed.length < 1 || trimmed.length > 100) {
    return { ok: false, error: '제목은 1~100자로 입력해주세요' }
  }

  const { error } = await ctx.admin
    .from('ai_conversations')
    .update({ title: trimmed })
    .eq('id', id)
    .eq('user_id', ctx.userId)
    .is('deleted_at', null)
  if (error) return { ok: false, error: '이름 변경 중 오류가 발생했습니다' }

  revalidatePath('/admin/ai-chat')
  return { ok: true }
}

export async function togglePin(
  id: string,
): Promise<{ ok: boolean; pinned?: boolean; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  const { data: cur } = await ctx.admin
    .from('ai_conversations')
    .select('pinned')
    .eq('id', id)
    .eq('user_id', ctx.userId)
    .is('deleted_at', null)
    .single()
  if (!cur) return { ok: false, error: '대화를 찾을 수 없습니다' }

  const next = !(cur as { pinned: boolean }).pinned
  const { error } = await ctx.admin
    .from('ai_conversations')
    .update({ pinned: next })
    .eq('id', id)
    .eq('user_id', ctx.userId)
  if (error) return { ok: false, error: '핀 변경 중 오류가 발생했습니다' }

  revalidatePath('/admin/ai-chat')
  return { ok: true, pinned: next }
}

export async function updateConversationModel(
  id: string,
  provider: AiChatProviderId,
  model: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  if (!isValidProvider(provider)) return { ok: false, error: '유효하지 않은 프로바이더' }

  const trimmed = model?.trim()
  if (!trimmed) return { ok: false, error: '모델을 선택해주세요' }
  if (!isValidModel(trimmed)) return { ok: false, error: '유효하지 않은 모델' }

  const meta = await readMeta(ctx.admin)
  if (!getProviderConfig(meta, provider)) {
    return { ok: false, error: '해당 프로바이더의 AI 키가 설정되지 않았습니다' }
  }

  const { error } = await ctx.admin
    .from('ai_conversations')
    .update({ provider, model: trimmed })
    .eq('id', id)
    .eq('user_id', ctx.userId)
    .is('deleted_at', null)
  if (error) return { ok: false, error: '모델 변경 중 오류가 발생했습니다' }

  revalidatePath('/admin/ai-chat')
  return { ok: true }
}

// ── Delete / 복원 (소프트삭제) ──
export async function softDeleteConversation(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  const { error } = await ctx.admin
    .from('ai_conversations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', ctx.userId)
  if (error) return { ok: false, error: '삭제 중 오류가 발생했습니다' }

  revalidatePath('/admin/ai-chat')
  return { ok: true }
}

export async function restoreConversation(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  const { error } = await ctx.admin
    .from('ai_conversations')
    .update({ deleted_at: null })
    .eq('id', id)
    .eq('user_id', ctx.userId)
  if (error) return { ok: false, error: '복원 중 오류가 발생했습니다' }

  revalidatePath('/admin/ai-chat')
  return { ok: true }
}

// ── 자동 제목 (AI 생성 + 실패 시 30자 절삭 폴백, throw 금지) ──
export async function autoTitle(
  conversationId: string,
): Promise<{ ok: boolean; title?: string; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  // 대화 + 첫 user/assistant 페어 로드
  const { data: convRow } = await ctx.admin
    .from('ai_conversations')
    .select('id, provider, model')
    .eq('id', conversationId)
    .eq('user_id', ctx.userId)
    .is('deleted_at', null)
    .single()
  const conv = convRow as Pick<
    AiChatConversation,
    'id' | 'provider' | 'model'
  > | null
  if (!conv) return { ok: false, error: '대화를 찾을 수 없습니다' }

  const { data: msgRows } = await ctx.admin
    .from('ai_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .is('error', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(2)
  const msgs = (msgRows ?? []) as Pick<AiChatMessage, 'role' | 'content'>[]
  const firstUser = msgs.find((m) => m.role === 'user')?.content ?? ''

  // 폴백: 첫 사용자 메시지 앞 30자
  const fallback = firstUser
    ? firstUser.slice(0, 30) + (firstUser.length > 30 ? '…' : '')
    : '새 대화'

  const applyTitle = async (title: string) => {
    await ctx.admin
      .from('ai_conversations')
      .update({ title })
      .eq('id', conversationId)
      .eq('user_id', ctx.userId)
    revalidatePath('/admin/ai-chat')
  }

  try {
    const meta = await readMeta(ctx.admin)
    const config = getProviderConfig(meta, conv.provider)
    if (!config || !firstUser) {
      await applyTitle(fallback)
      return { ok: true, title: fallback }
    }

    const pairText = msgs.map((m) => `${m.role}: ${m.content}`).join('\n')
    const provider = getProvider(conv.provider)
    let generated = ''
    const result = await provider.streamChat({
      apiKey: config.apiKey,
      model: conv.model,
      system: '다음 대화에 어울리는 제목을 한국어 15자 이내 명사구로만 답하라. 따옴표·마침표·설명 금지.',
      turns: [{ role: 'user', content: pairText.slice(0, 4000) }],
      maxOutputTokens: 64,
      signal: AbortSignal.timeout(15000),
      onDelta: (t) => {
        generated += t
      },
    })

    logTokenUsage({
      userId: ctx.userId,
      feature: 'ai-chat',
      model: conv.model,
      provider: conv.provider,
      promptTokens: result.usage.promptTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    })

    const clean = generated
      .replace(/["'`\n]/g, '')
      .trim()
      .slice(0, 40)
    const title = clean || fallback
    await applyTitle(title)
    return { ok: true, title }
  } catch {
    try {
      await applyTitle(fallback)
    } catch {
      // 무시
    }
    return { ok: true, title: fallback }
  }
}
