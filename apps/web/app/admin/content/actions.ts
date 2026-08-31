'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { recordSystemEvent } from '@/lib/system-log/record'

/**
 * 조직 콘텐츠 저장 결과 — **값으로** 돌려준다.
 *
 * 왜 `redirect()` 를 쓰지 않는가 (실측 2026-08-31):
 *   이 액션들은 `ContentSections.tsx`(클라이언트)가 `await action(fd)` 로 부른다.
 *   서버 액션이 redirect 하면 Next 가 응답을 되돌려주지 못하고
 *   (`failed to forward action response ... httpRedirectFetch`) 화면은 결과를 못 읽는다.
 *   주간보고 저장이 같은 이유로 **2주간 100% 실패**했다.
 *
 * 그리고 이 파일에는 조용한 실패가 셋 더 있었다 — 전부 「저장됐습니다」 토스트가 떴다:
 *   ① 권한 없음·세션 만료 → `if (!ctx) return` 로 **아무 말 없이 종료**
 *   ② JSON 이 깨짐 → `if (value)` 가 거짓이라 **저장을 건너뛰고 성공 처리**
 *   ③ DB 오류 → supabase-js 는 던지지 않고 `{ error }` 를 **반환**하는데 아무도 안 봤다
 * 셋 다 여기서 값으로 돌려주고, 화면이 그 값을 읽어 사용자에게 말한다.
 */
export interface ContentActionResult {
  ok: boolean
  error?: string
}

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as unknown as { data: { role: string } | null; error: unknown }

  if (!profile || profile.role !== 'admin') return null

  return { user, adminClient }
}

/** 실패를 기록한다 — 기록 실패가 저장 실패를 덮지 않게 삼킨다 */
async function logFailure(err: unknown, key: string, actorId?: string | null): Promise<void> {
  await recordSystemEvent({
    source: 'host_api',
    error: err,
    feature: `admin-content-save:${key}`,
    route: '/admin/content',
    actorId: actorId ?? null,
    blocksUser: true,
  }).catch(() => { /* 로그 실패가 저장 실패를 덮지 않는다 */ })
}

async function updateOrgContent(key: string, value: unknown): Promise<ContentActionResult> {
  const ctx = await requireAdmin()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다. 다시 로그인해 주세요.' }

  const { user, adminClient } = ctx

  try {
    // ⚠️ supabase-js 는 쓰기 실패를 **던지지 않고 반환**한다 — 반드시 error 를 읽는다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (adminClient.from('org_content') as any)
      .update({ value: value as Record<string, unknown>, updated_by: user.id })
      .eq('key', key)

    if (error) {
      await logFailure(error, key, user.id)
      return { ok: false, error: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
    }
  } catch (err) {
    await logFailure(err, key, user.id)
    return { ok: false, error: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }

  revalidatePath('/admin/content')
  revalidatePath('/dashboard')
  revalidatePath('/operations')
  return { ok: true }
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

/**
 * JSON 텍스트 한 칸을 그대로 저장하는 섹션들의 공통 경로.
 * 깨진 JSON 을 **조용히 건너뛰지 않는다** — 어디가 잘못됐는지 사용자에게 말한다.
 */
async function saveJsonSection(key: string, raw: string | null): Promise<ContentActionResult> {
  const value = parseJson(raw)
  if (value === null) {
    return { ok: false, error: 'JSON 형식이 올바르지 않습니다. 대괄호·쉼표를 확인해 주세요.' }
  }
  return updateOrgContent(key, value)
}

// ─── 섹션별 Server Action ─────────────────────────────────────────────────

export async function updateMeta(formData: FormData): Promise<ContentActionResult> {
  const ctx = await requireAdmin()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다. 다시 로그인해 주세요.' }
  const { adminClient } = ctx

  // 기존 META 읽어서 머지 — gemini_api_key/gemini_model 등 다른 필드 보존
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (adminClient.from('org_content') as any)
    .select('value')
    .eq('key', 'META')
    .single()
  const prev = (existing?.value as Record<string, unknown>) ?? {}

  const value = {
    ...prev,
    org: formData.get('org') as string,
    title: formData.get('title') as string,
    subtitle: formData.get('subtitle') as string,
    version: formData.get('version') as string,
    date: formData.get('date') as string,
  }
  return updateOrgContent('META', value)
}

export async function updateProjects(formData: FormData): Promise<ContentActionResult> {
  return saveJsonSection('projects', formData.get('projects_json') as string)
}

export async function updateMembers(formData: FormData): Promise<ContentActionResult> {
  return saveJsonSection('members', formData.get('members_json') as string)
}

export async function updateMissions(formData: FormData): Promise<ContentActionResult> {
  return saveJsonSection('missions', formData.get('missions_json') as string)
}

export async function updateOkr(formData: FormData): Promise<ContentActionResult> {
  return saveJsonSection('okr', formData.get('okr_json') as string)
}

export async function updatePrinciples(formData: FormData): Promise<ContentActionResult> {
  return saveJsonSection('principles', formData.get('principles_json') as string)
}

export async function updateKpiTargets(formData: FormData): Promise<ContentActionResult> {
  return saveJsonSection('kpi_targets', formData.get('kpi_targets_json') as string)
}

export async function updateRhythm(formData: FormData): Promise<ContentActionResult> {
  return saveJsonSection('rhythm', formData.get('rhythm_json') as string)
}

export async function updateRoutineTemplates(formData: FormData): Promise<ContentActionResult> {
  return saveJsonSection('routine_templates', formData.get('routine_templates_json') as string)
}

export async function updateDevSplit(formData: FormData): Promise<ContentActionResult> {
  return saveJsonSection('dev_split', formData.get('dev_split_json') as string)
}

export async function updateH1Kpi(formData: FormData): Promise<ContentActionResult> {
  return saveJsonSection('h1_kpi', formData.get('h1_kpi_json') as string)
}

export async function updateYearKpi(formData: FormData): Promise<ContentActionResult> {
  return saveJsonSection('year_kpi', formData.get('year_kpi_json') as string)
}

export async function updateExtSlots(formData: FormData): Promise<ContentActionResult> {
  return saveJsonSection('ext_slots', formData.get('ext_slots_json') as string)
}

const AI_ALLOWED_SECTION_KEYS = new Set([
  'projects', 'members', 'missions', 'okr',
  'principles', 'kpi_targets', 'routine_templates',
])

export async function aiApplySection(
  sectionKey: string,
  data: unknown[]
): Promise<ContentActionResult> {
  if (!AI_ALLOWED_SECTION_KEYS.has(sectionKey)) {
    return { ok: false, error: '허용되지 않은 섹션입니다' }
  }
  if (!Array.isArray(data)) {
    return { ok: false, error: '데이터 형식이 올바르지 않습니다' }
  }
  try {
    return await updateOrgContent(sectionKey, data)
  } catch (err) {
    await logFailure(err, sectionKey)
    return { ok: false, error: err instanceof Error ? err.message : '저장 실패' }
  }
}
