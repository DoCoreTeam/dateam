'use server'

import { google } from 'googleapis'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getTokens, refreshTokenIfNeeded } from '@/lib/google-drive'
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

/**
 * Google Drive 연결 확인.
 * 다른 연동 카드와 동일하게 **버튼을 눌렀을 때만** 외부를 호출한다.
 * (진입 시 자동 조회하던 것을 v0.7.439에서 제거 — 카드마다 동작이 갈리면 안 된다, §2-5)
 * 토큰 유효성까지 봐야 "연결됨"이 참인지 알 수 있으므로 about.get으로 실제 호출한다.
 */
export async function checkGoogleDriveHealth(): Promise<{ ok: boolean; message: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, message: '관리자 권한이 필요합니다' }

  const tokens = await getTokens()
  if (!tokens) return { ok: false, message: '연결된 Google 계정이 없습니다' }

  try {
    const auth = await refreshTokenIfNeeded()
    const drive = google.drive({ version: 'v3', auth })
    const { data } = await drive.about.get({ fields: 'user(emailAddress),storageQuota(limit,usage)' })

    const email = data.user?.emailAddress ?? tokens.accountEmail
    const { limit, usage } = data.storageQuota ?? {}
    if (limit && usage) {
      const gb = (n: string) => (Number(n) / 1024 ** 3).toFixed(1)
      return { ok: true, message: `연결 성공 — ${email} · 사용량 ${gb(usage)}GB / ${gb(limit)}GB` }
    }
    return { ok: true, message: `연결 성공 — ${email}` }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : ''
    // 리프레시 토큰이 만료·철회된 경우가 가장 흔하다 — 무엇을 해야 하는지까지 알려준다
    if (/invalid_grant|Token has been expired or revoked/i.test(msg)) {
      return { ok: false, message: '인증이 만료되었습니다 — [변경]으로 Google 계정을 다시 연결해주세요' }
    }
    if (/insufficient|403/i.test(msg)) {
      return { ok: false, message: '권한이 부족합니다 — 다시 연결하며 드라이브 접근을 허용해주세요' }
    }
    return { ok: false, message: msg ? `연결 실패: ${msg}` : '네트워크 오류가 발생했습니다' }
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

// ── YouTube Data API 키 — Gemini 키와 같은 저장소(META), 같은 패턴 ──
// 왜 필요한가: 키가 없으면 채널 수집이 RSS(최근 15개)로 묶인다.
// 543개 올린 채널을 15개로 판단하게 되므로, 키 입력 자리가 없으면 제품이 반쪽이다.

export async function saveYoutubeKey(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const apiKey = (formData.get('apiKey') as string)?.trim()
  if (!apiKey) return { ok: false, error: 'API 키를 입력해주세요' }

  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const { error } = await setMetaValue(client, { ...meta, youtube_api_key: apiKey })

  if (error) return { ok: false, error: '저장 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

export async function deleteYoutubeKey(): Promise<{ ok: boolean; error?: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  delete meta.youtube_api_key
  const { error } = await setMetaValue(client, meta)

  if (error) return { ok: false, error: '삭제 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

/**
 * YouTube Data API 연결 확인.
 * 연결 테스트는 카드마다 있고 없고가 갈리면 안 된다(§UI 시스템) — 가능한 연동은 전부 제공한다.
 * 쿼터를 아끼려고 videos.list 1건(1유닛)만 부른다.
 */
export async function checkYoutubeHealth(): Promise<{ ok: boolean; message: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, message: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const apiKey = meta.youtube_api_key as string | undefined
  if (!apiKey) return { ok: false, message: '저장된 API 키가 없습니다' }

  try {
    const res = await fetch(
      `https://youtube.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${encodeURIComponent(apiKey)}`,
      { cache: 'no-store' },
    )
    if (res.ok) return { ok: true, message: '연결 성공 — 채널 전체 수집을 쓸 수 있습니다' }

    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    const msg = err?.error?.message ?? res.statusText
    // 프로젝트에서 API가 꺼져 있는 경우가 가장 흔하다 — 무엇을 해야 하는지까지 알려준다
    if (/has not been used in project|is disabled/i.test(msg)) {
      return { ok: false, message: 'Google Cloud 프로젝트에서 YouTube Data API v3가 꺼져 있습니다' }
    }
    return { ok: false, message: `API 오류: ${msg}` }
  } catch {
    return { ok: false, message: '네트워크 오류가 발생했습니다' }
  }
}

// ── 음성 인식(STT) 키 — 회의 녹음 전사에 쓴다 ──
// 왜 여기인가: CRM 은 키를 갖지 않는다는 기존 원칙과 같은 자리다. Gemini·Claude·OpenAI 키가
// 이미 여기 있고, 회의노트(사내)와 영업 CRM 이 **같은 키 하나**를 쓴다.
// 키가 없으면 녹음은 되는데 전사가 영영 안 된다 — 그래서 입력 자리가 반드시 있어야 한다.

export async function saveSttKey(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const apiKey = (formData.get('apiKey') as string)?.trim()
  if (!apiKey) return { ok: false, error: 'API 키를 입력해주세요' }
  const model = ((formData.get('model') as string) ?? '').trim()

  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const next: Record<string, unknown> = { ...meta, stt_api_key: apiKey, stt_provider: 'groq' }
  // 모델은 비워 두면 코드 기본값(정확도 우선)을 쓴다 — 빈 문자열을 저장해 두면
  // "설정했는데 왜 이 모델이지"를 아무도 설명 못 한다.
  if (model) next.stt_model = model
  else delete next.stt_model

  const { error } = await setMetaValue(client, next)
  if (error) return { ok: false, error: '저장 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

export async function deleteSttKey(): Promise<{ ok: boolean; error?: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  delete meta.stt_api_key
  delete meta.stt_model
  delete meta.stt_provider
  const { error } = await setMetaValue(client, meta)

  if (error) return { ok: false, error: '삭제 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

/**
 * 음성 인식 연결 확인.
 *
 * 모델 목록을 한 번 불러 본다 — 오디오를 올리지 않고도 키가 살아 있는지 알 수 있다.
 * 연결 테스트가 카드마다 있고 없고가 갈리면 안 된다(§2-5 동종 UI 통일).
 */
export async function checkSttHealth(): Promise<{ ok: boolean; message: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, message: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const apiKey = meta.stt_api_key as string | undefined
  if (!apiKey) return { ok: false, message: '저장된 API 키가 없습니다' }

  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    })
    if (res.ok) {
      const model = (meta.stt_model as string | undefined) ?? 'whisper-large-v3'
      return { ok: true, message: `연결 성공 — ${model} 으로 회의 녹음을 전사합니다` }
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: 'API 키가 올바르지 않습니다' }
    }
    return { ok: false, message: `연결 실패 (${res.status})` }
  } catch {
    return { ok: false, message: '네트워크 오류가 발생했습니다' }
  }
}
