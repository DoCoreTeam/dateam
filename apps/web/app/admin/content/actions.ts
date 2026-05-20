'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

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

export async function updateOrgContent(key: string, value: unknown): Promise<void> {
  const ctx = await requireAdmin()
  if (!ctx) return

  const { user, adminClient } = ctx

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient.from('org_content') as any)
    .update({ value: value as Record<string, unknown>, updated_by: user.id })
    .eq('key', key)

  redirect('/admin/content')
}

// --- 섹션별 Server Action ---

export async function updateMeta(formData: FormData): Promise<void> {
  const value = {
    org: formData.get('org') as string,
    title: formData.get('title') as string,
    subtitle: formData.get('subtitle') as string,
    version: formData.get('version') as string,
    date: formData.get('date') as string,
  }
  await updateOrgContent('META', value)
}

export async function updateProjects(formData: FormData): Promise<void> {
  const raw = formData.get('projects_json') as string
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return
  }
  await updateOrgContent('projects', value)
}

export async function updateMembers(formData: FormData): Promise<void> {
  const raw = formData.get('members_json') as string
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return
  }
  await updateOrgContent('members', value)
}

export async function updateMissions(formData: FormData): Promise<void> {
  const raw = formData.get('missions_json') as string
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return
  }
  await updateOrgContent('missions', value)
}

export async function updateOkr(formData: FormData): Promise<void> {
  const raw = formData.get('okr_json') as string
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return
  }
  await updateOrgContent('okr', value)
}

export async function updatePrinciples(formData: FormData): Promise<void> {
  const raw = formData.get('principles_json') as string
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return
  }
  await updateOrgContent('principles', value)
}

export async function updateKpiTargets(formData: FormData): Promise<void> {
  const raw = formData.get('kpi_targets_json') as string
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return
  }
  await updateOrgContent('kpi_targets', value)
}

export async function updateRhythm(formData: FormData): Promise<void> {
  const raw = formData.get('rhythm_json') as string
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return
  }
  await updateOrgContent('rhythm', value)
}

export async function updateRoutineTemplates(formData: FormData): Promise<void> {
  const raw = formData.get('routine_templates_json') as string
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return
  }
  await updateOrgContent('routine_templates', value)
}

export async function updateDevSplit(formData: FormData): Promise<void> {
  const raw = formData.get('dev_split_json') as string
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return
  }
  await updateOrgContent('dev_split', value)
}
