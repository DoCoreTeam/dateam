'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single() as unknown as { data: { role: string } | null; error: unknown }

  if (!profile || profile.role !== 'admin') return null
  return { user, supabase }
}

export async function createTier(formData: FormData): Promise<{ success?: boolean; error?: string }> {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '관리자 권한이 필요합니다' }

  const name = (formData.get('name') as string)?.trim()
  const discountRate = parseFloat(formData.get('discount_rate') as string)
  const description = (formData.get('description') as string)?.trim() || null

  if (!name) return { error: '등급명을 입력해주세요' }
  if (isNaN(discountRate) || discountRate < 0 || discountRate > 100) return { error: '할인율은 0~100 사이여야 합니다' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (ctx.supabase.from('partner_tiers') as any)
    .insert({ name, discount_rate: discountRate, description })

  if (error) return { error: error.message }

  revalidatePath('/admin/partner-tiers')
  return { success: true }
}

export async function updateTier(id: string, formData: FormData): Promise<{ success?: boolean; error?: string }> {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '관리자 권한이 필요합니다' }

  const name = (formData.get('name') as string)?.trim()
  const discountRate = parseFloat(formData.get('discount_rate') as string)
  const description = (formData.get('description') as string)?.trim() || null

  if (!name) return { error: '등급명을 입력해주세요' }
  if (isNaN(discountRate) || discountRate < 0 || discountRate > 100) return { error: '할인율은 0~100 사이여야 합니다' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (ctx.supabase.from('partner_tiers') as any)
    .update({ name, discount_rate: discountRate, description })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/admin/partner-tiers')
  return { success: true }
}

export async function deleteTier(id: string): Promise<{ success?: boolean; error?: string }> {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '관리자 권한이 필요합니다' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (ctx.supabase.from('partner_tiers') as any)
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/admin/partner-tiers')
  return { success: true }
}
