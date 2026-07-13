'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { AiChatProviderId } from '@/types/database'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1'
const OPENAI_API_BASE = 'https://api.openai.com/v1'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single() as unknown as { data: { role: string } | null }

  return profile?.role === 'admin' ? adminClient : null
}

async function getMetaValue(client: ReturnType<typeof createAdminClient>): Promise<Record<string, unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (client as any)
    .from('org_content')
    .select('value')
    .eq('key', 'META')
    .single()
  return (data?.value as Record<string, unknown>) ?? {}
}

async function setMetaValue(
  client: ReturnType<typeof createAdminClient>,
  meta: Record<string, unknown>
): Promise<{ error: unknown }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any)
    .from('org_content')
    .upsert({ key: 'META', value: meta }, { onConflict: 'key' })
}

export async function saveGeminiKey(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const apiKey = (formData.get('apiKey') as string)?.trim()
  if (!apiKey) return { ok: false, error: 'API 키를 입력해주세요' }

  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const { error } = await setMetaValue(client, { ...meta, gemini_api_key: apiKey })

  if (error) return { ok: false, error: '저장 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

export async function deleteGeminiKey(): Promise<{ ok: boolean; error?: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  delete meta.gemini_api_key
  const { error } = await setMetaValue(client, meta)

  if (error) return { ok: false, error: '삭제 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

// ── DB 연결 설정 (PostgreSQL 연결 문자열) — Gemini 키와 동일 패턴 ──
// (마스킹은 클라이언트(DbSettings)·page.tsx에서 직접 수행 — 'use server' 파일은 async export만 허용)

export async function saveDbUrl(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const dbUrl = (formData.get('dbUrl') as string)?.trim()
  if (!dbUrl) return { ok: false, error: 'DB 연결 문자열을 입력해주세요' }
  if (!/^postgres(ql)?:\/\//i.test(dbUrl)) return { ok: false, error: 'postgresql:// 형식이어야 합니다' }

  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const { error } = await setMetaValue(client, { ...meta, db_connection_url: dbUrl })
  if (error) return { ok: false, error: '저장 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

export async function deleteDbUrl(): Promise<{ ok: boolean; error?: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  delete meta.db_connection_url
  const { error } = await setMetaValue(client, meta)
  if (error) return { ok: false, error: '삭제 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

// DB 헬스체크 — 저장된 연결 문자열로 실제 접속해 SELECT 1
export async function checkDbHealth(): Promise<{ ok: boolean; message: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, message: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const dbUrl = meta.db_connection_url as string | undefined
  if (!dbUrl) return { ok: false, message: 'DB 연결 문자열을 먼저 저장해주세요' }

  const { Client } = await import('pg')
  const pg = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 8000, ssl: { rejectUnauthorized: false } })
  const t0 = Date.now()
  try {
    await pg.connect()
    const r = await pg.query('select version()')
    const ver = String(r.rows?.[0]?.version ?? '').split(' ').slice(0, 2).join(' ')
    return { ok: true, message: `연결 성공 (${Date.now() - t0}ms · ${ver})` }
  } catch (e) {
    return { ok: false, message: `연결 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}` }
  } finally {
    try { await pg.end() } catch { /* noop */ }
  }
}

export async function getGeminiModels(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const apiKey = meta.gemini_api_key as string | undefined
  if (!apiKey) return { ok: false, error: 'API 키를 먼저 저장해주세요' }

  try {
    const res = await fetch(`${GEMINI_API_BASE}/models`, {
      headers: { 'x-goog-api-key': apiKey },
      cache: 'no-store',
    })
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({})) as { error?: { message?: string } }
      return { ok: false, error: `API 오류: ${errJson?.error?.message ?? res.statusText}` }
    }
    const json = await res.json() as { models?: { name: string; supportedGenerationMethods?: string[] }[] }
    const models = (json.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace('models/', ''))
    return { ok: true, models }
  } catch {
    return { ok: false, error: '네트워크 오류가 발생했습니다' }
  }
}

export async function saveGeminiModel(model: string): Promise<{ ok: boolean; error?: string }> {
  if (!model) return { ok: false, error: '모델을 선택해주세요' }

  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const { error } = await setMetaValue(client, { ...meta, gemini_model: model })

  if (error) return { ok: false, error: '저장 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

export async function saveTokenAlertThreshold(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const raw = (formData.get('threshold') as string)?.replace(/,/g, '').trim()
  const threshold = parseInt(raw, 10)
  if (isNaN(threshold) || threshold < 0) return { ok: false, error: '올바른 숫자를 입력해주세요' }

  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const { error } = await setMetaValue(client, { ...meta, ai_token_alert_threshold: threshold })

  if (error) return { ok: false, error: '저장 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

export async function saveKoraeximKey(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const apiKey = (formData.get('apiKey') as string)?.trim()
  if (!apiKey) return { ok: false, error: 'API 키를 입력해주세요' }

  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const { error } = await setMetaValue(client, { ...meta, koreaexim_api_key: apiKey })

  if (error) return { ok: false, error: '저장 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

export async function deleteKoraeximKey(): Promise<{ ok: boolean; error?: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  delete meta.koreaexim_api_key
  const { error } = await setMetaValue(client, meta)

  if (error) return { ok: false, error: '삭제 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

export async function checkKoraeximHealth(): Promise<{ ok: boolean; message: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, message: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const apiKey = meta.koreaexim_api_key as string | undefined
  if (!apiKey) return { ok: false, message: '저장된 API 키가 없습니다' }

  try {
    const today = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' }).replace(/-/g, '')
    const url = `https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${apiKey}&searchdate=${today}&data=AP01`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return { ok: false, message: `API 응답 오류: ${res.status}` }
    const json = await res.json() as unknown[]
    if (!Array.isArray(json)) return { ok: false, message: '비정상 응답 (API 키를 확인해주세요)' }
    if (json.length === 0) return { ok: false, message: '데이터 없음 (휴장일이거나 키가 유효하지 않습니다)' }
    const usdRow = (json as Record<string, string>[]).find((r) => r.cur_unit === 'USD')
    if (!usdRow) return { ok: false, message: '연결 성공 — USD 환율 데이터 없음' }
    return { ok: true, message: `연결 성공 — 오늘 USD/KRW: ${usdRow.deal_bas_r}원` }
  } catch {
    return { ok: false, message: '네트워크 오류가 발생했습니다' }
  }
}

export async function checkGeminiHealth(): Promise<{ ok: boolean; message: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, message: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const apiKey = meta.gemini_api_key as string | undefined

  if (!apiKey) return { ok: false, message: '저장된 API 키가 없습니다' }

  try {
    const res = await fetch(`${GEMINI_API_BASE}/models`, {
      headers: { 'x-goog-api-key': apiKey },
      cache: 'no-store',
    })

    if (res.ok) {
      const json = await res.json() as { models?: unknown[] }
      return { ok: true, message: `연결 성공 — ${json.models?.length ?? 0}개 모델 사용 가능` }
    }

    const errJson = await res.json().catch(() => ({})) as { error?: { message?: string } }
    return { ok: false, message: `API 오류: ${errJson?.error?.message ?? res.statusText}` }
  } catch {
    return { ok: false, message: '네트워크 오류가 발생했습니다' }
  }
}

// ── AI 채팅(세션1): Claude / OpenAI 키·모델 + 기본 프로바이더 (META, saveGeminiKey 패턴 재사용) ──

export async function saveClaudeKey(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const apiKey = (formData.get('apiKey') as string)?.trim()
  if (!apiKey) return { ok: false, error: 'API 키를 입력해주세요' }

  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const { error } = await setMetaValue(client, { ...meta, claude_api_key: apiKey })
  if (error) {
    console.error('[settings] saveClaudeKey 저장 실패', error)
    return { ok: false, error: '저장 실패' }
  }

  revalidatePath('/admin/settings')
  return { ok: true }
}

export async function deleteClaudeKey(): Promise<{ ok: boolean; error?: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  delete meta.claude_api_key
  const { error } = await setMetaValue(client, meta)
  if (error) return { ok: false, error: '삭제 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

export async function saveClaudeModel(model: string): Promise<{ ok: boolean; error?: string }> {
  if (!model) return { ok: false, error: '모델을 선택해주세요' }

  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const { error } = await setMetaValue(client, { ...meta, claude_model: model })
  if (error) return { ok: false, error: '저장 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

export async function getClaudeModels(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const apiKey = meta.claude_api_key as string | undefined
  if (!apiKey) return { ok: false, error: 'API 키를 먼저 저장해주세요' }

  try {
    const res = await fetch(`${ANTHROPIC_API_BASE}/models`, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      cache: 'no-store',
    })
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({})) as { error?: { message?: string } }
      console.error('[settings] getClaudeModels API 오류', errJson?.error?.message ?? res.statusText)
      return { ok: false, error: '연결 실패' }
    }
    const json = await res.json() as { data?: { id: string }[] }
    const models = (json.data ?? []).map((m) => m.id)
    return { ok: true, models }
  } catch (e) {
    console.error('[settings] getClaudeModels 네트워크 오류', e)
    return { ok: false, error: '연결 실패' }
  }
}

export async function saveOpenAiKey(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const apiKey = (formData.get('apiKey') as string)?.trim()
  if (!apiKey) return { ok: false, error: 'API 키를 입력해주세요' }

  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const { error } = await setMetaValue(client, { ...meta, openai_api_key: apiKey })
  if (error) {
    console.error('[settings] saveOpenAiKey 저장 실패', error)
    return { ok: false, error: '저장 실패' }
  }

  revalidatePath('/admin/settings')
  return { ok: true }
}

export async function deleteOpenAiKey(): Promise<{ ok: boolean; error?: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  delete meta.openai_api_key
  const { error } = await setMetaValue(client, meta)
  if (error) return { ok: false, error: '삭제 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

export async function saveOpenAiModel(model: string): Promise<{ ok: boolean; error?: string }> {
  if (!model) return { ok: false, error: '모델을 선택해주세요' }

  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const { error } = await setMetaValue(client, { ...meta, openai_model: model })
  if (error) return { ok: false, error: '저장 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

export async function getOpenAiModels(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const apiKey = meta.openai_api_key as string | undefined
  if (!apiKey) return { ok: false, error: 'API 키를 먼저 저장해주세요' }

  try {
    const res = await fetch(`${OPENAI_API_BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({})) as { error?: { message?: string } }
      console.error('[settings] getOpenAiModels API 오류', errJson?.error?.message ?? res.statusText)
      return { ok: false, error: '연결 실패' }
    }
    const json = await res.json() as { data?: { id: string }[] }
    const models = (json.data ?? [])
      .map((m) => m.id)
      .filter((id) => /^(gpt|o\d|chatgpt)/i.test(id))
      .sort()
    return { ok: true, models }
  } catch (e) {
    console.error('[settings] getOpenAiModels 네트워크 오류', e)
    return { ok: false, error: '연결 실패' }
  }
}

export async function saveAiChatDefaultProvider(
  provider: AiChatProviderId | '',
): Promise<{ ok: boolean; error?: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  if (provider === '') {
    delete meta.ai_chat_default_provider // 빈 값이면 키 제거(폴백=첫 available)
  } else {
    meta.ai_chat_default_provider = provider
  }
  const { error } = await setMetaValue(client, meta)
  if (error) return { ok: false, error: '저장 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}
