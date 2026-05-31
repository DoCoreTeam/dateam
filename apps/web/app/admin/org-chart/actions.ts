'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).is('deleted_at', null).single()
  if (!profile || profile.role !== 'admin') return null
  return { user, db }
}

export async function updateCompany(formData: FormData) {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }

  const name = (formData.get('name') as string)?.trim()
  const description = (formData.get('description') as string)?.trim() || null
  if (!name) return { error: '회사명을 입력하세요' }

  const { error } = await ctx.db.from('org_company')
    .update({ name, description, updated_at: new Date().toISOString() })
    .eq('id', 1)

  if (error) return { error: (error as { message: string }).message }
  revalidatePath('/admin/org-chart')
  revalidatePath('/org')
  return { error: null }
}

export async function createDepartment(formData: FormData) {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }

  const name = (formData.get('name') as string)?.trim()
  const description = (formData.get('description') as string)?.trim() || null
  const parent_id = (formData.get('parent_id') as string) || null
  if (!name) return { error: '부서명을 입력하세요' }

  const { error } = await ctx.db.from('org_departments')
    .insert({ name, description, parent_id, display_order: 999 })

  if (error) return { error: (error as { message: string }).message }
  revalidatePath('/admin/org-chart')
  revalidatePath('/org')
  return { error: null }
}

export async function updateDepartment(id: string, formData: FormData) {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }

  const name = (formData.get('name') as string)?.trim()
  const description = (formData.get('description') as string)?.trim() || null
  const parent_id = (formData.get('parent_id') as string) || null
  if (!name) return { error: '부서명을 입력하세요' }

  const { error } = await ctx.db.from('org_departments')
    .update({ name, description, parent_id })
    .eq('id', id)

  if (error) return { error: (error as { message: string }).message }
  revalidatePath('/admin/org-chart')
  revalidatePath('/org')
  return { error: null }
}

export async function deleteDepartment(id: string) {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }

  const { data: children } = await ctx.db.from('org_departments')
    .select('id').eq('parent_id', id).limit(1)

  if (children && (children as unknown[]).length > 0) return { error: '하위 부서가 있어 삭제할 수 없습니다' }

  const { error } = await ctx.db.from('org_departments').delete().eq('id', id)
  if (error) return { error: (error as { message: string }).message }
  revalidatePath('/admin/org-chart')
  revalidatePath('/org')
  return { error: null }
}

export async function moveDepartment(
  id: string,
  direction: 'up' | 'down',
  siblings: { id: string; display_order: number }[],
) {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }

  const idx = siblings.findIndex((s) => s.id === id)
  if (idx < 0) return { error: '항목 없음' }

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= siblings.length) return { error: null }

  const a = siblings[idx]
  const b = siblings[swapIdx]

  await Promise.all([
    ctx.db.from('org_departments').update({ display_order: b.display_order }).eq('id', a.id),
    ctx.db.from('org_departments').update({ display_order: a.display_order }).eq('id', b.id),
  ])

  revalidatePath('/admin/org-chart')
  revalidatePath('/org')
  return { error: null }
}

export async function addMember(departmentId: string, userId: string) {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }

  const { error } = await ctx.db.from('org_department_members')
    .insert({ department_id: departmentId, user_id: userId })

  if (error) {
    const e = error as { message: string; code?: string }
    return { error: e.code === '23505' ? '이미 해당 부서에 속한 사용자입니다' : e.message }
  }
  revalidatePath('/admin/org-chart')
  revalidatePath('/org')
  return { error: null }
}

export async function removeMember(departmentId: string, userId: string) {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }

  const { error } = await ctx.db.from('org_department_members')
    .delete()
    .eq('department_id', departmentId)
    .eq('user_id', userId)

  if (error) return { error: (error as { message: string }).message }
  revalidatePath('/admin/org-chart')
  revalidatePath('/org')
  return { error: null }
}

export async function createRank(name: string) {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }
  const { error } = await ctx.db.from('org_ranks').insert({ name, display_order: 999 })
  if (error) {
    const e = error as { message: string; code?: string }
    return { error: e.code === '23505' ? '이미 존재하는 직급입니다' : e.message }
  }
  revalidatePath('/admin/org-chart')
  return { error: null }
}

export async function deleteRank(id: number) {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }
  const { error } = await ctx.db.from('org_ranks').delete().eq('id', id)
  if (error) return { error: (error as { message: string }).message }
  revalidatePath('/admin/org-chart')
  return { error: null }
}

export async function createPosition(name: string) {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }
  const { error } = await ctx.db.from('org_positions').insert({ name, display_order: 999 })
  if (error) {
    const e = error as { message: string; code?: string }
    return { error: e.code === '23505' ? '이미 존재하는 직책입니다' : e.message }
  }
  revalidatePath('/admin/org-chart')
  return { error: null }
}

export async function deletePosition(id: number) {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }
  const { error } = await ctx.db.from('org_positions').delete().eq('id', id)
  if (error) return { error: (error as { message: string }).message }
  revalidatePath('/admin/org-chart')
  return { error: null }
}

export async function updateUserProfile(
  userId: string,
  data: { name: string; rank: string | null; position: string | null },
) {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }
  const { error } = await ctx.db.from('profiles')
    .update({ name: data.name, rank: data.rank || null, position: data.position || null })
    .eq('id', userId)
  if (error) return { error: (error as { message: string }).message }
  revalidatePath('/admin/users')
  revalidatePath('/admin/org-chart')
  return { error: null }
}
