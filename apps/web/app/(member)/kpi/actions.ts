'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function insertKpi(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const metricName = formData.get('metric_name') as string
  const value = parseFloat(formData.get('value') as string)
  const unit = formData.get('unit') as string
  const periodStart = formData.get('period_start') as string
  const periodEnd = formData.get('period_end') as string

  if (!metricName || isNaN(value) || !periodStart || !periodEnd) {
    redirect('/kpi?error=모든 필드를 올바르게 입력해주세요')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('kpi_entries') as any).insert({
    user_id: user.id,
    metric_name: metricName,
    value,
    unit: unit || '',
    period_start: periodStart,
    period_end: periodEnd,
  })

  if (error) redirect(`/kpi?error=${encodeURIComponent(error.message)}`)

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
