'use server'

import { google } from 'googleapis'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getTokens, refreshTokenIfNeeded } from '@/lib/google-drive'
import type { AiChatProviderId } from '@/types/database'
import { readVercelConfig, VERCEL_META } from '@/lib/vercel/config'
import { fetchProject, VercelApiError } from '@/lib/vercel/api'
import { fetchKoraeximJson } from '@/lib/gpu/koreaexim'
import type { AiProviderId } from '@/lib/ai/provider-catalog'
import {
  validateProviderKey,
  withProviderKey,
  withProviderModel,
  withoutProviderKey,
  readProviderKey,
  describeKeySaved,
  describeConnectionOk,
  describeConnectionFailed,
  describeMissingKey,
} from '@/lib/ai/provider-keys'
import { getProvider } from '@/lib/ai-chat/registry'

// 회의 녹음 전사 설정 — 키가 아니라 전사 갈래의 값이라 공급자 창구와 따로 둔다
// (키 자체는 Groq 공급자 키를 그대로 쓴다)
const TRANSCRIPTION_MODEL_META = 'stt_model'

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
    // 호출은 lib/gpu/koreaexim(SSOT) — 그 서버가 중간 인증서를 안 보내서 기본 fetch 는
    //   Node 에서 TLS 검증에 실패한다. 예전엔 그 실패가 「네트워크 오류」로만 보여서
    //   키가 멀쩡한데도 연결 테스트가 늘 빨간불이었다(실측 2026-09-03).
    const json = await fetchKoraeximJson(apiKey, today) as unknown[] | null
    if (json == null) return { ok: false, message: 'API 응답을 받지 못했습니다 (잠시 후 다시 시도해 주세요)' }
    if (!Array.isArray(json)) return { ok: false, message: '비정상 응답 (API 키를 확인해주세요)' }
    if (json.length === 0) return { ok: false, message: '데이터 없음 (휴장일이거나 키가 유효하지 않습니다)' }
    const usdRow = (json as Record<string, string>[]).find((r) => r.cur_unit === 'USD')
    if (!usdRow) return { ok: false, message: '연결 성공: USD 환율 데이터 없음' }
    return { ok: true, message: `연결 성공: 오늘 USD/KRW: ${usdRow.deal_bas_r}원` }
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
      return { ok: true, message: `연결 성공: ${email} · 사용량 ${gb(usage)}GB / ${gb(limit)}GB` }
    }
    return { ok: true, message: `연결 성공: ${email}` }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : ''
    // 리프레시 토큰이 만료·철회된 경우가 가장 흔하다 — 무엇을 해야 하는지까지 알려준다
    if (/invalid_grant|Token has been expired or revoked/i.test(msg)) {
      return { ok: false, message: '인증이 만료되었습니다. [변경]으로 Google 계정을 다시 연결해주세요' }
    }
    if (/insufficient|403/i.test(msg)) {
      return { ok: false, message: '권한이 부족합니다. 다시 연결하며 드라이브 접근을 허용해주세요' }
    }
    return { ok: false, message: msg ? `연결 실패: ${msg}` : '네트워크 오류가 발생했습니다' }
  }
}

// ── AI 채팅(세션1): Claude / OpenAI 키·모델 + 기본 프로바이더 (META, saveGeminiKey 패턴 재사용) ──


/* ── AI 공급자 키 창구 한 벌 ─────────────────────────────────
   저장 삭제 모델저장 연결확인 넷을 공급자 id 하나로 받는다. 규칙(접두사·무엇이 함께 멈추는지·
   뭐라고 말할지)은 lib/ai/provider-keys 에, 모델 목록을 부르는 방법은 레지스트리 어댑터에 있다 —
   여기서는 권한과 DB 왕복만 한다. 예전에는 이 넷이 공급자마다 한 벌씩, 모두 열여섯 벌이었다. */

export async function saveProviderKey(
  provider: AiProviderId,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  const raw = (formData.get('apiKey') as string) ?? ''

  const check = validateProviderKey(provider, raw)
  if (!check.ok) return { ok: false, error: check.error }

  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const { error } = await setMetaValue(client, withProviderKey(provider, raw, meta))
  if (error) {
    console.error('[settings] 공급자 키 저장 실패', provider, error)
    return { ok: false, error: '저장 중 오류가 발생했습니다' }
  }

  revalidatePath('/admin/settings')
  return { ok: true, message: describeKeySaved(provider, raw) }
}

export async function deleteProviderKey(
  provider: AiProviderId,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const { meta: next, warning } = withoutProviderKey(provider, meta)
  const { error } = await setMetaValue(client, next)
  if (error) return { ok: false, error: '삭제 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  // 무엇이 함께 멈추는지 말한다 — Groq 을 「AI 공급자」로만 알고 해제하면 회의 전사가 조용히 멈춘다
  return { ok: true, message: warning ?? undefined }
}

export async function saveProviderModel(
  provider: AiProviderId,
  model: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!model) return { ok: false, error: '모델을 선택해주세요' }

  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const { error } = await setMetaValue(client, withProviderModel(provider, model, meta))
  if (error) return { ok: false, error: '저장 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

/** 저장된 키로 모델 목록을 받아 온다. 부르는 방법은 공급자 어댑터가 안다 */
export async function listProviderModels(
  provider: AiProviderId,
): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const apiKey = readProviderKey(provider, await getMetaValue(client))
  if (!apiKey) return { ok: false, error: 'API 키를 먼저 저장해주세요' }

  try {
    return { ok: true, models: await getProvider(provider).listModels(apiKey) }
  } catch (e) {
    console.error('[settings] 모델 목록 조회 실패', provider, e)
    return { ok: false, error: describeConnectionFailed(provider, statusOf(e)) }
  }
}

export async function checkProviderConnection(
  provider: AiProviderId,
): Promise<{ ok: boolean; message: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, message: '관리자 권한이 필요합니다' }

  const apiKey = readProviderKey(provider, await getMetaValue(client))
  if (!apiKey) return { ok: false, message: describeMissingKey(provider) }

  try {
    const models = await getProvider(provider).listModels(apiKey)
    return { ok: true, message: describeConnectionOk(provider, models.length) }
  } catch (e) {
    console.error('[settings] 연결 확인 실패', provider, e)
    return { ok: false, message: describeConnectionFailed(provider, statusOf(e)) }
  }
}

/** 공급자 SDK 가 던진 오류에서 상태 코드만 꺼낸다. 원문은 키 조각이 섞여 올 수 있어 흘리지 않는다 */
function statusOf(e: unknown): number | undefined {
  const status = (e as { status?: unknown })?.status
  return typeof status === 'number' ? status : undefined
}

/** 회의 녹음 전사 모델. Groq 키를 쓰지만 채팅 모델과는 다른 값이다 */
export async function saveTranscriptionModel(model: string): Promise<{ ok: boolean; error?: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const next = { ...meta }
  // 비워 두면 코드 기본값(정확도 우선)을 쓴다 — 빈 문자열을 저장해 두면
  // "설정했는데 왜 이 모델이지"를 아무도 설명 못 한다.
  if (model.trim()) next[TRANSCRIPTION_MODEL_META] = model.trim()
  else delete next[TRANSCRIPTION_MODEL_META]

  const { error } = await setMetaValue(client, next)
  if (error) return { ok: false, error: '저장 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  return { ok: true }
}

/* ── 아래는 옛 이름들. 화면(I11)이 공급자 카드 한 벌로 바뀌면 사라진다.
   지금은 위 창구를 부르기만 한다 — 두 벌이 되면 카드마다 다른 검증을 탄다. */

export async function saveGeminiKey(formData: FormData) { return saveProviderKey('gemini', formData) }
export async function deleteGeminiKey() { return deleteProviderKey('gemini') }
export async function saveGeminiModel(model: string) { return saveProviderModel('gemini', model) }
export async function getGeminiModels() { return listProviderModels('gemini') }
export async function checkGeminiHealth() { return checkProviderConnection('gemini') }

export async function saveClaudeKey(formData: FormData) { return saveProviderKey('claude', formData) }
export async function deleteClaudeKey() { return deleteProviderKey('claude') }
export async function saveClaudeModel(model: string) { return saveProviderModel('claude', model) }
export async function getClaudeModels() { return listProviderModels('claude') }

export async function saveOpenAiKey(formData: FormData) { return saveProviderKey('openai', formData) }
export async function deleteOpenAiKey() { return deleteProviderKey('openai') }
export async function saveOpenAiModel(model: string) { return saveProviderModel('openai', model) }
export async function getOpenAiModels() { return listProviderModels('openai') }

// 음성 인식 카드. 키는 Groq 공급자 키이고, 전사 모델만 따로 받는다
export async function saveSttKey(formData: FormData) {
  const saved = await saveProviderKey('groq', formData)
  if (!saved.ok) return saved
  return saveTranscriptionModel(((formData.get('model') as string) ?? ''))
}
export async function deleteSttKey() { return deleteProviderKey('groq') }
export async function checkSttHealth() { return checkProviderConnection('groq') }

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
    if (res.ok) return { ok: true, message: '연결 성공: 채널 전체 수집을 쓸 수 있습니다' }

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

// ── Vercel 로그 연동 — 배포·서버 로그를 우리 화면에서 읽는다 ──
//
// 왜 여기인가: 다른 외부 연동과 **같은 자리·같은 모양**이다(§2-5). 카드마다 저장 방식이 갈리면
// 관리자는 매번 "이건 어떻게 저장하지"를 다시 배운다.
//
// 왜 환경변수가 아닌가: 이 값이 필요한 이유가 "배포 대시보드에 안 들어가고 보려고"인데,
// 환경변수로 두면 넣을 수 있는 사람이 다시 대시보드에 들어갈 수 있는 사람으로 좁혀진다.

export async function saveVercelKey(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const token = (formData.get('token') as string)?.trim()
  const projectId = (formData.get('projectId') as string)?.trim()
  const teamId = ((formData.get('teamId') as string) ?? '').trim()

  if (!token) return { ok: false, error: '토큰을 입력해주세요' }
  if (!projectId) return { ok: false, error: '프로젝트 ID(또는 이름)를 입력해주세요' }

  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  const next: Record<string, unknown> = {
    ...meta,
    [VERCEL_META.token]: token,
    [VERCEL_META.projectId]: projectId,
  }
  // 팀 ID 는 개인 프로젝트엔 없다. 빈 문자열을 남겨 두면 "설정했는데 왜 안 되지"가 된다
  if (teamId) next[VERCEL_META.teamId] = teamId
  else delete next[VERCEL_META.teamId]

  const { error } = await setMetaValue(client, next)
  if (error) return { ok: false, error: '저장 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  revalidatePath('/admin/system-log')
  return { ok: true }
}

export async function deleteVercelKey(): Promise<{ ok: boolean; error?: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, error: '관리자 권한이 필요합니다' }

  const meta = await getMetaValue(client)
  delete meta[VERCEL_META.token]
  delete meta[VERCEL_META.projectId]
  delete meta[VERCEL_META.teamId]
  const { error } = await setMetaValue(client, meta)

  if (error) return { ok: false, error: '연결 해제 중 오류가 발생했습니다' }

  revalidatePath('/admin/settings')
  revalidatePath('/admin/system-log')
  return { ok: true }
}

/**
 * 연결 확인. 프로젝트 한 건을 읽어 본다 — 토큰·프로젝트·팀 셋을 **한 번에** 검증하는
 * 가장 싼 호출이고, 아무것도 바꾸지 않는다.
 */
export async function checkVercelHealth(): Promise<{ ok: boolean; message: string }> {
  const client = await requireAdmin()
  if (!client) return { ok: false, message: '관리자 권한이 필요합니다' }

  const cfg = readVercelConfig(await getMetaValue(client))
  if (!cfg.ok) return { ok: false, message: cfg.message }

  try {
    const project = await fetchProject(cfg.config)
    return { ok: true, message: `연결 성공: 프로젝트 「${project.name}」의 배포·서버 로그를 읽습니다` }
  } catch (e) {
    // 실패 사유를 그대로 전한다. "연결 실패"만 말하면 관리자가 다음에 할 일을 모른다
    return { ok: false, message: e instanceof VercelApiError ? e.message : 'Vercel에 연결하지 못했습니다' }
  }
}
