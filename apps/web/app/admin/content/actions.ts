'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as unknown as { data: { role: string } | null; error: unknown }

  if (!profile || profile.role !== 'admin') return null

  return { user, adminClient }
}

async function updateOrgContent(key: string, value: unknown): Promise<void> {
  const ctx = await requireAdmin()
  if (!ctx) return

  const { user, adminClient } = ctx

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient.from('org_content') as any)
    .update({ value: value as Record<string, unknown>, updated_by: user.id })
    .eq('key', key)

  revalidatePath('/admin/content')
  revalidatePath('/dashboard')
  revalidatePath('/operations')
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

// ─── 섹션별 Server Action ─────────────────────────────────────────────────

export async function updateMeta(formData: FormData): Promise<void> {
  const ctx = await requireAdmin()
  if (!ctx) return
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
  await updateOrgContent('META', value)
  redirect('/admin/content')
}

export async function updateProjects(formData: FormData): Promise<void> {
  const value = parseJson(formData.get('projects_json') as string)
  if (value) await updateOrgContent('projects', value)
  redirect('/admin/content')
}

export async function updateMembers(formData: FormData): Promise<void> {
  const value = parseJson(formData.get('members_json') as string)
  if (value) await updateOrgContent('members', value)
  redirect('/admin/content')
}

export async function updateMissions(formData: FormData): Promise<void> {
  const value = parseJson(formData.get('missions_json') as string)
  if (value) await updateOrgContent('missions', value)
  redirect('/admin/content')
}

export async function updateOkr(formData: FormData): Promise<void> {
  const value = parseJson(formData.get('okr_json') as string)
  if (value) await updateOrgContent('okr', value)
  redirect('/admin/content')
}

export async function updatePrinciples(formData: FormData): Promise<void> {
  const value = parseJson(formData.get('principles_json') as string)
  if (value) await updateOrgContent('principles', value)
  redirect('/admin/content')
}

export async function updateKpiTargets(formData: FormData): Promise<void> {
  const value = parseJson(formData.get('kpi_targets_json') as string)
  if (value) await updateOrgContent('kpi_targets', value)
  redirect('/admin/content')
}

export async function updateRhythm(formData: FormData): Promise<void> {
  const value = parseJson(formData.get('rhythm_json') as string)
  if (value) await updateOrgContent('rhythm', value)
  redirect('/admin/content')
}

export async function updateRoutineTemplates(formData: FormData): Promise<void> {
  const value = parseJson(formData.get('routine_templates_json') as string)
  if (value) await updateOrgContent('routine_templates', value)
  redirect('/admin/content')
}

export async function updateDevSplit(formData: FormData): Promise<void> {
  const value = parseJson(formData.get('dev_split_json') as string)
  if (value) await updateOrgContent('dev_split', value)
  redirect('/admin/content')
}

export async function updateH1Kpi(formData: FormData): Promise<void> {
  const value = parseJson(formData.get('h1_kpi_json') as string)
  if (value) await updateOrgContent('h1_kpi', value)
  redirect('/admin/content')
}

export async function updateYearKpi(formData: FormData): Promise<void> {
  const value = parseJson(formData.get('year_kpi_json') as string)
  if (value) await updateOrgContent('year_kpi', value)
  redirect('/admin/content')
}

export async function updateExtSlots(formData: FormData): Promise<void> {
  const value = parseJson(formData.get('ext_slots_json') as string)
  if (value) await updateOrgContent('ext_slots', value)
  redirect('/admin/content')
}
