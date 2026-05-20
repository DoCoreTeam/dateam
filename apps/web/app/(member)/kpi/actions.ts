'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

interface WeeklyKpiTarget {
  label: string
  target: string
  unit?: string
}

function err(msg: string): never {
  redirect(`/kpi?error=${encodeURIComponent(msg)}`)
}

export async function insertKpi(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // kpi_metric_ref = "source:index" 형식 (예: "kpi_targets:0", "h1_kpi:1", "year_kpi:2")
  const ref = formData.get('kpi_metric_ref') as string
  const value = parseFloat(formData.get('value') as string)
  const periodStart = formData.get('period_start') as string
  const periodEnd = formData.get('period_end') as string

  const [source, idxStr] = (ref ?? '').split(':')
  const idx = parseInt(idxStr, 10)
  const validSources = ['kpi_targets', 'h1_kpi', 'year_kpi']

  if (!validSources.includes(source) || isNaN(idx) || isNaN(value) || !periodStart || !periodEnd) {
    err('모든 필드를 올바르게 입력해주세요')
  }

  // 서버에서 org_content 재조회 — 클라이언트 입력값 미신뢰
  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contentRow } = await (adminClient as any)
    .from('org_content')
    .select('value')
    .eq('key', source)
    .single() as { data: { value: unknown } | null }

  let metricName: string
  let unit: string

  if (source === 'kpi_targets') {
    const kpiTargets: WeeklyKpiTarget[] = Array.isArray(contentRow?.value) ? (contentRow!.value as WeeklyKpiTarget[]) : []
    const template = kpiTargets[idx]
    if (!template) err('유효하지 않은 KPI 항목입니다')
    metricName = template.label
    unit = template.unit ?? ''
  } else {
    const items: string[] = Array.isArray(contentRow?.value) ? (contentRow!.value as string[]) : []
    const item = items[idx]
    if (!item) err('유효하지 않은 KPI 항목입니다')
    metricName = item
    unit = ''
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('kpi_entries') as any).insert({
    user_id: user.id,
    metric_name: metricName,
    value,
    unit,
    period_start: periodStart,
    period_end: periodEnd,
  })

  if (error) err(error.message)

  revalidatePath('/kpi')
  revalidatePath('/dashboard')
  redirect('/kpi')
}

export async function deleteKpi(id: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: '인증이 필요합니다' }

  const { error } = await supabase
    .from('kpi_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { error: error.message }

  revalidatePath('/kpi')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function updateKpi(
  id: string,
  data: { metric_name: string; value: number; unit: string; period_start: string; period_end: string }
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: '인증이 필요합니다' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('kpi_entries') as any)
    .update(data)
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { error: error.message }

  revalidatePath('/kpi')
  revalidatePath('/dashboard')
  return { success: true }
}
