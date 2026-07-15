'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { logTokenUsage } from '@/lib/token-logger'
import { getAvailableProviders, getProvider, getProviderConfig } from '@/lib/ai-chat/registry'
import { buildThreadForChoice, getBranchGroups } from '@/lib/ai-chat/thread'
import { chunkText, embedKnowledgeChunks } from '@/lib/ai-chat/knowledge'
import { sanitizeSearchQuery } from '@/lib/ai-chat/search'
import { mergeModelCatalogEntry, inferModelMeta, inferModelUseCase, isChatModel, type ModelCapabilities } from '@/lib/ai-chat/model-catalog'
import type {
  AiChatProviderId,
  AiChatConversation,
  AiChatMessage,
  AiChatProject,
} from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

const AI_CHAT_BUCKET = 'ai-chat'
const SIGNED_URL_TTL_SEC = 3600 // getMessages 첨부 재표시용 서명 URL TTL 1h

const CONV_COLUMNS =
  'id, user_id, title, provider, model, system_prompt, pinned, created_at, updated_at, deleted_at, project_id, shared, share_token'
const MSG_COLUMNS =
  'id, conversation_id, role, content, thinking, provider, model, prompt_tokens, output_tokens, stopped, error, created_at, feedback, parent_message_id, citations'
const PROJECT_COLUMNS = 'id, user_id, name, instructions, created_at, updated_at, deleted_at'

const MAX_PROJECT_NAME = 100
const MAX_PROJECT_INSTRUCTIONS = 4000
const MAX_SOURCE_LEN = 200

// getMessages 반환 첨부 뷰(04 §6-2 D-5)
export interface AttachmentView {
  id: string
  filename: string
  mime: string
  kind: string
  sizeBytes: number
  signedUrl: string
}
// 편집분기 네비게이션 메타(세션3 §5-5) — user 메시지의 버전 그룹 크기 ≥2일 때만 부가
export interface BranchMeta {
  rootId: string
  index: number // 표시 중 버전의 1-base 순번
  count: number // 버전 그룹 크기
  versions: string[] // 버전 messageId asc — 클라 ‹k/n› 전환용(choices 갱신)
}
export type MessageWithAttachments = AiChatMessage & {
  attachments: AttachmentView[]
  branch?: BranchMeta
}

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

// 소유 검증: 활성 프로젝트가 본인 소유인지
async function ownsProject(admin: AdminClient, userId: string, id: string): Promise<boolean> {
  if (typeof id !== 'string' || !id) return false
  const { data } = await admin
    .from('ai_projects')
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

  revalidatePath('/ai-chat')
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

// ── Read: 메시지 (전체 로드 → 활성 스레드 재구성 → 커서 페이지네이션 + 첨부 signedUrl) ──
export async function getMessages(input: {
  conversationId: string
  before?: string
  limit?: number
  choices?: Record<string, string> // S3 §5-5 — 그룹(rootId)별 열람 버전 선택
}): Promise<{
  ok: boolean
  items?: MessageWithAttachments[]
  nextCursor?: string | null
  error?: string
}> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }
  if (!(await ownsConversation(ctx.admin, ctx.userId, input.conversationId))) {
    return { ok: false, error: '대화를 찾을 수 없습니다' }
  }

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)

  // 전체 로드(asc) → 활성 스레드 재구성(편집분기 반영은 전체 컨텍스트 필요 — 서버 재구성)
  const { data, error } = await ctx.admin
    .from('ai_messages')
    .select(MSG_COLUMNS)
    .eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) return { ok: false, error: '메시지 조회 중 오류가 발생했습니다' }

  const sorted = (data ?? []) as AiChatMessage[] // asc
  // 선택 버전(choices) 기준 열람 스레드 재구성 — 빈 choices ≡ buildActiveThread(sorted)
  const active = buildThreadForChoice(sorted, input.choices ?? {})

  // 버전 그룹(크기 ≥2)만 — user 메시지 branch 메타 산출용
  const groupOf = new Map<string, { root: string; versions: string[] }>()
  for (const [root, versions] of Array.from(getBranchGroups(sorted).entries())) {
    for (const v of versions) groupOf.set(v, { root, versions })
  }

  // 커서: before 미만만(오래된 페이지로 이동) → 최근 limit건
  const scoped = input.before ? active.filter((m) => m.created_at < input.before!) : active
  const hasMore = scoped.length > limit
  const page = hasMore ? scoped.slice(scoped.length - limit) : scoped
  const nextCursor = hasMore ? page[0].created_at : null

  // 첨부 일괄 조회 + 서명 URL 신규 발급(TTL 1h)
  const attByMsg = new Map<string, AttachmentView[]>()
  const ids = page.map((m) => m.id)
  if (ids.length > 0) {
    const { data: attRows } = await ctx.admin
      .from('ai_attachments')
      .select('id, message_id, storage_path, filename, mime, size_bytes, kind')
      .in('message_id', ids)
    const rows = (attRows ?? []) as Array<{
      id: string
      message_id: string
      storage_path: string
      filename: string
      mime: string
      size_bytes: number
      kind: string
    }>
    const urlByPath = new Map<string, string>()
    const paths = rows.map((r) => r.storage_path)
    if (paths.length > 0) {
      const { data: signed } = await ctx.admin.storage
        .from(AI_CHAT_BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL_SEC)
      for (const s of (signed ?? []) as Array<{ path: string | null; signedUrl: string }>) {
        if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl)
      }
    }
    for (const r of rows) {
      const list = attByMsg.get(r.message_id) ?? []
      list.push({
        id: r.id,
        filename: r.filename,
        mime: r.mime,
        kind: r.kind,
        sizeBytes: r.size_bytes,
        signedUrl: urlByPath.get(r.storage_path) ?? '',
      })
      attByMsg.set(r.message_id, list)
    }
  }

  const items: MessageWithAttachments[] = page.map((m) => {
    const g = groupOf.get(m.id)
    const branch: BranchMeta | undefined = g
      ? { rootId: g.root, index: g.versions.indexOf(m.id) + 1, count: g.versions.length, versions: g.versions }
      : undefined
    return {
      ...m,
      attachments: attByMsg.get(m.id) ?? [],
      ...(branch ? { branch } : {}),
    }
  })
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

  revalidatePath('/ai-chat')
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

  revalidatePath('/ai-chat')
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

  revalidatePath('/ai-chat')
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

  revalidatePath('/ai-chat')
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

  revalidatePath('/ai-chat')
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
    revalidatePath('/ai-chat')
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

// 본문 매치 ±40자 발췌 (plain) — 매치 위치 못 찾으면 앞부분 발췌.
function makeSnippet(content: string, term: string): string | null {
  const idx = content.toLowerCase().indexOf(term.toLowerCase())
  if (idx < 0) {
    const head = content.slice(0, 80).trim()
    return head || null
  }
  const start = Math.max(0, idx - 40)
  const end = Math.min(content.length, idx + term.length + 40)
  let s = content.slice(start, end).trim()
  if (start > 0) s = '…' + s
  if (end < content.length) s = s + '…'
  return s || null
}

// ── 대화 검색 (제목 + 본문, .or() 미사용 — 2쿼리 분리 병합) ──
export async function searchConversations(q: string): Promise<{
  ok: boolean
  items?: Array<{
    id: string
    title: string
    pinned: boolean
    updated_at: string
    snippet: string | null
  }>
  error?: string
}> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  const sanitized = sanitizeSearchQuery(typeof q === 'string' ? q : '')
  if (!sanitized) return { ok: true, items: [] }
  const pattern = `%${sanitized}%`
  const term = q.trim()

  // 본인 대화 메타(스코프 + 병합용) — admin 전용 규모라 전량 로드 허용
  const { data: convData } = await ctx.admin
    .from('ai_conversations')
    .select('id, title, pinned, updated_at')
    .eq('user_id', ctx.userId)
    .is('deleted_at', null)
  const convList = (convData ?? []) as Array<{
    id: string
    title: string
    pinned: boolean
    updated_at: string
  }>
  const convMap = new Map(convList.map((c) => [c.id, c]))
  const convIds = convList.map((c) => c.id)

  // Q1: 제목 매치
  const { data: titleData } = await ctx.admin
    .from('ai_conversations')
    .select('id, title, pinned, updated_at')
    .eq('user_id', ctx.userId)
    .is('deleted_at', null)
    .ilike('title', pattern)
    .limit(20)
  const titleRows = (titleData ?? []) as Array<{
    id: string
    title: string
    pinned: boolean
    updated_at: string
  }>

  // Q2: 본문 매치 (본인 대화 스코프)
  let msgRows: Array<{ conversation_id: string; content: string }> = []
  if (convIds.length > 0) {
    const { data: msgData } = await ctx.admin
      .from('ai_messages')
      .select('conversation_id, content')
      .in('conversation_id', convIds)
      .ilike('content', pattern)
      .order('created_at', { ascending: true })
      .limit(20)
    msgRows = (msgData ?? []) as Array<{ conversation_id: string; content: string }>
  }

  const merged = new Map<
    string,
    { id: string; title: string; pinned: boolean; updated_at: string; snippet: string | null }
  >()
  // 본문 매치 우선(첫 매치 발췌) — 제목만 매치면 null
  for (const m of msgRows) {
    if (merged.has(m.conversation_id)) continue
    const conv = convMap.get(m.conversation_id)
    if (!conv) continue
    merged.set(m.conversation_id, { ...conv, snippet: makeSnippet(m.content, term) })
  }
  for (const c of titleRows) {
    if (!merged.has(c.id)) merged.set(c.id, { ...c, snippet: null })
  }

  const items = Array.from(merged.values())
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (a.updated_at < b.updated_at) return 1
      if (a.updated_at > b.updated_at) return -1
      return 0
    })
    .slice(0, 20)

  return { ok: true, items }
}

// ── 대화별 시스템프롬프트 (trim·4000자 상한·빈문자열→null, throw 금지) ──
export async function updateSystemPrompt(
  conversationId: string,
  systemPrompt: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }
  if (!(await ownsConversation(ctx.admin, ctx.userId, conversationId))) {
    return { ok: false, error: '대화를 찾을 수 없습니다' }
  }

  let value: string | null = null
  if (typeof systemPrompt === 'string') {
    const trimmed = systemPrompt.trim()
    if (trimmed.length > 4000) {
      return { ok: false, error: '시스템 프롬프트는 4000자 이하로 입력해주세요' }
    }
    value = trimmed.length === 0 ? null : trimmed
  }

  const { error } = await ctx.admin
    .from('ai_conversations')
    .update({ system_prompt: value })
    .eq('id', conversationId)
    .eq('user_id', ctx.userId)
    .is('deleted_at', null)
  if (error) return { ok: false, error: '시스템 프롬프트 저장 중 오류가 발생했습니다' }

  revalidatePath('/ai-chat')
  return { ok: true }
}

// ── 응답 피드백 (👍/👎, 메시지→대화 소유 검증) ──
export async function setMessageFeedback(
  messageId: string,
  feedback: 1 | -1 | null,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }
  if (feedback !== 1 && feedback !== -1 && feedback !== null) {
    return { ok: false, error: '유효하지 않은 피드백' }
  }

  const { data: msg } = await ctx.admin
    .from('ai_messages')
    .select('id, conversation_id')
    .eq('id', messageId)
    .single()
  const m = msg as { id: string; conversation_id: string } | null
  if (!m || !(await ownsConversation(ctx.admin, ctx.userId, m.conversation_id))) {
    return { ok: false, error: '메시지를 찾을 수 없습니다' }
  }

  const { error } = await ctx.admin
    .from('ai_messages')
    .update({ feedback })
    .eq('id', messageId)
  if (error) return { ok: false, error: '피드백 저장 중 오류가 발생했습니다' }

  return { ok: true }
}

// ════════════════════════════════════════════════════════════════════════
// 세션 3 — Projects · Knowledge · Share (04 §6-2)
// 전 액션 { ok, …, error? } 봉투 · requireAdmin(getCtx) + 소유 검증 후 createAdminClient
// ════════════════════════════════════════════════════════════════════════

// ── Projects: Create ──
export async function createProject(
  name: string,
  instructions?: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed.length < 1 || trimmed.length > MAX_PROJECT_NAME) {
    return { ok: false, error: `프로젝트 이름은 1~${MAX_PROJECT_NAME}자로 입력해주세요` }
  }
  let inst: string | null = null
  if (typeof instructions === 'string') {
    const it = instructions.trim()
    if (it.length > MAX_PROJECT_INSTRUCTIONS) {
      return { ok: false, error: `지시문은 ${MAX_PROJECT_INSTRUCTIONS}자 이하로 입력해주세요` }
    }
    inst = it.length === 0 ? null : it
  }

  const { data, error } = await ctx.admin
    .from('ai_projects')
    .insert({ user_id: ctx.userId, name: trimmed, instructions: inst })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: '프로젝트 생성 중 오류가 발생했습니다' }

  revalidatePath('/ai-chat/projects')
  return { ok: true, id: (data as { id: string }).id }
}

// ── Projects: List (최신순, deleted_at IS NULL) ──
export async function listProjects(): Promise<{
  ok: boolean
  items?: AiChatProject[]
  error?: string
}> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  const { data, error } = await ctx.admin
    .from('ai_projects')
    .select(PROJECT_COLUMNS)
    .eq('user_id', ctx.userId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
  if (error) return { ok: false, error: '목록 조회 중 오류가 발생했습니다' }

  return { ok: true, items: (data ?? []) as AiChatProject[] }
}

// ── Projects: Update (updated_at = now() 명시 갱신 — touch 트리거 없음) ──
export async function updateProject(
  id: string,
  patch: { name?: string; instructions?: string },
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch?.name !== undefined) {
    const trimmed = typeof patch.name === 'string' ? patch.name.trim() : ''
    if (trimmed.length < 1 || trimmed.length > MAX_PROJECT_NAME) {
      return { ok: false, error: `프로젝트 이름은 1~${MAX_PROJECT_NAME}자로 입력해주세요` }
    }
    update.name = trimmed
  }
  if (patch?.instructions !== undefined) {
    if (typeof patch.instructions === 'string') {
      const it = patch.instructions.trim()
      if (it.length > MAX_PROJECT_INSTRUCTIONS) {
        return { ok: false, error: `지시문은 ${MAX_PROJECT_INSTRUCTIONS}자 이하로 입력해주세요` }
      }
      update.instructions = it.length === 0 ? null : it
    } else {
      update.instructions = null
    }
  }

  const { error } = await ctx.admin
    .from('ai_projects')
    .update(update)
    .eq('id', id)
    .eq('user_id', ctx.userId)
    .is('deleted_at', null)
  if (error) return { ok: false, error: '프로젝트 수정 중 오류가 발생했습니다' }

  revalidatePath('/ai-chat/projects')
  return { ok: true }
}

// ── Projects: Soft Delete (deleted_at=now(); 연결 대화 project_id 유지) ──
export async function softDeleteProject(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  const { error } = await ctx.admin
    .from('ai_projects')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', ctx.userId)
  if (error) return { ok: false, error: '삭제 중 오류가 발생했습니다' }

  revalidatePath('/ai-chat/projects')
  return { ok: true }
}

// ── 대화-프로젝트 연결/해제 ──
export async function setConversationProject(
  conversationId: string,
  projectId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }
  if (!(await ownsConversation(ctx.admin, ctx.userId, conversationId))) {
    return { ok: false, error: '대화를 찾을 수 없습니다' }
  }
  if (projectId !== null) {
    if (!(await ownsProject(ctx.admin, ctx.userId, projectId))) {
      return { ok: false, error: '프로젝트를 찾을 수 없습니다' }
    }
  }

  const { error } = await ctx.admin
    .from('ai_conversations')
    .update({ project_id: projectId })
    .eq('id', conversationId)
    .eq('user_id', ctx.userId)
    .is('deleted_at', null)
  if (error) return { ok: false, error: '프로젝트 연결 중 오류가 발생했습니다' }

  revalidatePath('/ai-chat')
  return { ok: true }
}

// ── 지식: 텍스트 추가 (청크 → 임베딩 → 저장) ──
export async function addKnowledgeText(
  projectId: string,
  text: string,
  source: string,
): Promise<{ ok: boolean; chunks?: number; embedded?: number; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }
  if (!(await ownsProject(ctx.admin, ctx.userId, projectId))) {
    return { ok: false, error: '프로젝트를 찾을 수 없습니다' }
  }

  const body = typeof text === 'string' ? text.trim() : ''
  if (!body) return { ok: false, error: '내용이 비어 있습니다' }

  const src = ((typeof source === 'string' ? source.trim() : '') || 'manual').slice(0, MAX_SOURCE_LEN)
  const chunks = chunkText(body)
  if (chunks.length === 0) return { ok: false, error: '내용이 비어 있습니다' }

  const embedded = await embedKnowledgeChunks(projectId, src, chunks, ctx.userId)

  revalidatePath(`/ai-chat/projects/${projectId}`)
  return { ok: true, chunks: chunks.length, embedded }
}

// ── 지식: 목록 (source 단위 그룹 — 청크 수·최신 생성일) ──
export async function listKnowledge(projectId: string): Promise<{
  ok: boolean
  items?: { source: string; chunks: number; createdAt: string }[]
  error?: string
}> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }
  if (!(await ownsProject(ctx.admin, ctx.userId, projectId))) {
    return { ok: false, error: '프로젝트를 찾을 수 없습니다' }
  }

  const { data, error } = await ctx.admin
    .from('ai_project_knowledge')
    .select('source, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) return { ok: false, error: '지식 조회 중 오류가 발생했습니다' }

  const rows = (data ?? []) as { source: string | null; created_at: string }[]
  const map = new Map<string, { source: string; chunks: number; createdAt: string }>()
  for (const r of rows) {
    const key = r.source ?? 'manual'
    const cur = map.get(key)
    if (cur) {
      cur.chunks += 1
      if (r.created_at > cur.createdAt) cur.createdAt = r.created_at
    } else {
      map.set(key, { source: key, chunks: 1, createdAt: r.created_at })
    }
  }
  const items = Array.from(map.values()).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  )
  return { ok: true, items }
}

// ── 지식: source 단위 일괄 삭제 ──
export async function deleteKnowledgeSource(
  projectId: string,
  source: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }
  if (!(await ownsProject(ctx.admin, ctx.userId, projectId))) {
    return { ok: false, error: '프로젝트를 찾을 수 없습니다' }
  }
  if (typeof source !== 'string' || !source) {
    return { ok: false, error: '유효하지 않은 소스' }
  }

  const { error } = await ctx.admin
    .from('ai_project_knowledge')
    .delete()
    .eq('project_id', projectId)
    .eq('source', source)
  if (error) return { ok: false, error: '지식 삭제 중 오류가 발생했습니다' }

  revalidatePath(`/ai-chat/projects/${projectId}`)
  return { ok: true }
}

// ── 공유 옵트인 토글 (153 — admin 경계 내) ──
export async function toggleShare(
  conversationId: string,
  on: boolean,
): Promise<{ ok: boolean; token?: string | null; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }
  if (!(await ownsConversation(ctx.admin, ctx.userId, conversationId))) {
    return { ok: false, error: '대화를 찾을 수 없습니다' }
  }

  if (on) {
    const token = randomUUID()
    const { error } = await ctx.admin
      .from('ai_conversations')
      .update({ shared: true, share_token: token })
      .eq('id', conversationId)
      .eq('user_id', ctx.userId)
      .is('deleted_at', null)
    if (error) return { ok: false, error: '공유 설정 중 오류가 발생했습니다' }
    revalidatePath('/ai-chat')
    return { ok: true, token }
  }

  const { error } = await ctx.admin
    .from('ai_conversations')
    .update({ shared: false, share_token: null })
    .eq('id', conversationId)
    .eq('user_id', ctx.userId)
    .is('deleted_at', null)
  if (error) return { ok: false, error: '공유 해제 중 오류가 발생했습니다' }
  revalidatePath('/ai-chat')
  return { ok: true, token: null }
}

// ════════════════════════════════════════════════════════════════════════
// ⑤ 모델 선택 모달 — DB 캐시 기반 모델 카탈로그(마이그 156 ai_model_catalog)
// ════════════════════════════════════════════════════════════════════════

export interface ModelCatalogItem {
  provider: AiChatProviderId
  modelId: string
  label: string
  contextLength: number | null
  capabilities: ModelCapabilities
  releasedAt: string | null
  useCase: string   // "무엇에 쓰는지" 친절 안내
}

interface ModelCatalogRow {
  provider: AiChatProviderId
  model_id: string
  label: string
  context_length: number | null
  capabilities: Partial<ModelCapabilities> | null
  released_at: string | null
  is_active: boolean
}

// ── 키가 설정된 프로바이더의 카탈로그(is_active만) 조회 — 모델 선택 모달 데이터 소스 ──
export async function listModelCatalog(): Promise<{
  ok: boolean
  items?: ModelCatalogItem[]
  error?: string
}> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await readMeta(ctx.admin)
  const available = getAvailableProviders(meta).map((c) => c.id)
  if (available.length === 0) return { ok: true, items: [] }

  const { data, error } = await ctx.admin
    .from('ai_model_catalog')
    .select('provider, model_id, label, context_length, capabilities, released_at, is_active')
    .in('provider', available)
    .eq('is_active', true)
    .order('released_at', { ascending: false, nullsFirst: false })
  if (error) return { ok: false, error: '모델 카탈로그 조회 중 오류가 발생했습니다' }

  const rows = (data ?? []) as ModelCatalogRow[]
  // 비채팅 모델 제외 + 표시 시점 추론 fallback(이미 저장된 빈칸 행도 능력·출시일이 즉시 뜨게).
  const items: ModelCatalogItem[] = rows
    .filter((r) => isChatModel(r.provider, r.model_id))
    .map((r) => {
      const inferred = inferModelMeta(r.provider, r.model_id)
      const dbCaps = r.capabilities ?? {}
      const capsEmpty = !dbCaps.vision && !dbCaps.longContext && !dbCaps.reasoning
      const capabilities = capsEmpty
        ? inferred.capabilities
        : { vision: false, longContext: false, reasoning: false, ...dbCaps }
      return {
        provider: r.provider,
        modelId: r.model_id,
        label: r.label ?? inferred.label,
        contextLength: r.context_length ?? inferred.contextLength ?? null,
        capabilities,
        releasedAt: r.released_at ?? inferred.releasedAt ?? null,
        useCase: inferModelUseCase(r.provider, r.model_id, capabilities),
      }
    })
  return { ok: true, items }
}

// ── 실 프로바이더 응답(listModels)으로 카탈로그 갱신 — capabilities/released_at은 기존값 보존 ──
export async function refreshModelCatalog(
  provider: AiChatProviderId,
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const ctx = await getCtx()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }
  if (!isValidProvider(provider)) return { ok: false, error: '유효하지 않은 프로바이더' }

  const meta = await readMeta(ctx.admin)
  const config = getProviderConfig(meta, provider)
  if (!config) return { ok: false, error: '해당 프로바이더의 AI 키가 설정되지 않았습니다' }

  let modelIds: string[]
  try {
    modelIds = await getProvider(provider).listModels(config.apiKey)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '모델 목록 조회에 실패했습니다' }
  }
  // 비채팅 모델(임베딩·TTS·이미지 등) 제외 — 모델 선택에 무관.
  modelIds = modelIds.filter((id) => isChatModel(provider, id))
  if (modelIds.length === 0) return { ok: true, count: 0 }

  const { data: existingData } = await ctx.admin
    .from('ai_model_catalog')
    .select('model_id, label, context_length, capabilities, released_at')
    .eq('provider', provider)
    .in('model_id', modelIds)
  const existingRows = (existingData ?? []) as Array<{
    model_id: string
    label: string | null
    context_length: number | null
    capabilities: Partial<ModelCapabilities> | null
    released_at: string | null
  }>
  const existingMap = new Map(existingRows.map((r) => [r.model_id, r]))

  const upsertRows = modelIds.map((modelId) => {
    const existing = existingMap.get(modelId)
    const merged = mergeModelCatalogEntry(provider, modelId, {
      label: existing?.label,
      contextLength: existing?.context_length,
      capabilities: existing?.capabilities,
      releasedAt: existing?.released_at,
    })
    return {
      provider: merged.provider,
      model_id: merged.modelId,
      label: merged.label,
      context_length: merged.contextLength,
      capabilities: merged.capabilities,
      released_at: merged.releasedAt,
      is_active: true,
      fetched_at: new Date().toISOString(),
    }
  })

  const { error: upsertError } = await ctx.admin
    .from('ai_model_catalog')
    .upsert(upsertRows, { onConflict: 'provider,model_id' })
  if (upsertError) return { ok: false, error: '모델 카탈로그 저장 중 오류가 발생했습니다' }

  // 더 이상 응답에 없는 기존 모델은 비활성화(목록에서 숨김, 행은 보존)
  const { error: deactivateError } = await ctx.admin
    .from('ai_model_catalog')
    .update({ is_active: false })
    .eq('provider', provider)
    .not('model_id', 'in', `(${modelIds.join(',')})`)
  if (deactivateError) {
    // 비활성화 실패는 치명적이지 않음(다음 새로고침에서 재시도) — upsert는 이미 성공했으므로 ok 유지
  }

  revalidatePath('/ai-chat')
  return { ok: true, count: upsertRows.length }
}
