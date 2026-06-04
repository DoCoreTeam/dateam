'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
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
