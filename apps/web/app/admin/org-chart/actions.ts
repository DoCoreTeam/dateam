'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

type NodeType = 'company' | 'role' | 'department' | 'person'

interface DbError {
  message: string
  code?: string
}

interface OrgNode {
  id: string
  parent_id: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any

async function requireAdmin(): Promise<{ user: { id: string }; db: AnyDb } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: profile } = await db
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()
  if (!profile || profile.role !== 'admin') return null
  return { user, db }
}

function revalidateOrgPaths(): void {
  revalidatePath('/admin/org-chart')
  revalidatePath('/org')
}

// ─────────────────────────────────────────────
// Company (org_company — not migrated)
// ─────────────────────────────────────────────

export async function updateCompany(
  formData: FormData,
): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }

  const name = (formData.get('name') as string)?.trim()
  const description = (formData.get('description') as string)?.trim() || null
  if (!name) return { error: '회사명을 입력하세요' }

  const { error } = await ctx.db
    .from('org_company')
    .update({ name, description, updated_at: new Date().toISOString() })
    .eq('id', 1)

  if (error) return { error: (error as DbError).message }
  revalidateOrgPaths()
  return { error: null }
}

// ─────────────────────────────────────────────
// org_nodes CRUD
// ─────────────────────────────────────────────

export async function createNode(data: {
  type: NodeType
  parent_id: string
  name: string
  subtitle?: string | null
  user_id?: string | null
}): Promise<{ error: string | null; id?: string }> {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }

  const name = data.name.trim()
  if (!name) return { error: '이름을 입력하세요' }

  // Always append at end: max sibling display_order + 1
  const { data: siblings } = await ctx.db
    .from('org_nodes')
    .select('display_order')
    .eq('parent_id', data.parent_id)
  const maxOrder = (siblings && siblings.length > 0)
    ? Math.max(...(siblings as { display_order: number }[]).map(s => s.display_order))
    : -1

  const insert: Record<string, unknown> = {
    type: data.type,
    parent_id: data.parent_id,
    name,
    subtitle: data.subtitle?.trim() || null,
    display_order: maxOrder + 1,
  }

  if (data.type === 'person' && data.user_id) {
    insert.user_id = data.user_id
  }

  const { data: created, error } = await ctx.db
    .from('org_nodes')
    .insert(insert)
    .select('id')
    .single()

  if (error) return { error: (error as DbError).message }
  revalidateOrgPaths()
  return { error: null, id: (created as { id: string }).id }
}

export async function updateNode(
  id: string,
  data: {
    name: string
    subtitle?: string | null
    head_user_id?: string | null
  },
): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }

  const name = data.name.trim()
  if (!name) return { error: '이름을 입력하세요' }

  const update: Record<string, unknown> = {
    name,
    subtitle: data.subtitle?.trim() || null,
    updated_at: new Date().toISOString(),
  }

  if ('head_user_id' in data) {
    update.head_user_id = data.head_user_id ?? null
  }

  const { error } = await ctx.db
    .from('org_nodes')
    .update(update)
    .eq('id', id)

  if (error) return { error: (error as DbError).message }
  revalidateOrgPaths()
  return { error: null }
}

export async function deleteNode(id: string): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }

  const { data: children } = await ctx.db
    .from('org_nodes')
    .select('id')
    .eq('parent_id', id)
    .limit(1)

  if (children && (children as unknown[]).length > 0) {
    return { error: '하위 노드가 있어 삭제할 수 없습니다' }
  }

  const { error } = await ctx.db.from('org_nodes').delete().eq('id', id)
  if (error) return { error: (error as DbError).message }
  revalidateOrgPaths()
  return { error: null }
}

export async function moveNode(
  nodeId: string,
  newParentId: string,
): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }

  // Fetch all nodes to walk the ancestor chain
  const { data: allNodes, error: fetchError } = await ctx.db
    .from('org_nodes')
    .select('id, parent_id')

  if (fetchError) return { error: (fetchError as DbError).message }

  const nodes = (allNodes as OrgNode[]) ?? []

  // Check: newParentId must not be a descendant of nodeId
  const isDescendant = (): boolean => {
    let current: string | null = newParentId
    const visited = new Set<string>()
    while (current !== null) {
      if (current === nodeId) return true
      if (visited.has(current)) break
      visited.add(current)
      const found = nodes.find((n) => n.id === current)
      current = found?.parent_id ?? null
    }
    return false
  }

  if (isDescendant()) {
    return { error: '자신의 하위 노드로 이동할 수 없습니다' }
  }

  const { error } = await ctx.db
    .from('org_nodes')
    .update({ parent_id: newParentId, updated_at: new Date().toISOString() })
    .eq('id', nodeId)

  if (error) return { error: (error as DbError).message }
  revalidateOrgPaths()
  return { error: null }
}

export async function setHeadUser(
  nodeId: string,
  userId: string | null,
): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }

  const { error } = await ctx.db
    .from('org_nodes')
    .update({ head_user_id: userId, updated_at: new Date().toISOString() })
    .eq('id', nodeId)

  if (error) return { error: (error as DbError).message }
  revalidateOrgPaths()
  return { error: null }
}

export async function reorderNode(
  nodeId: string,
  direction: 'up' | 'down',
  siblingIds: string[],
): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }

  const idx = siblingIds.indexOf(nodeId)
  if (idx < 0) return { error: '노드를 찾을 수 없습니다' }

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= siblingIds.length) return { error: null }

  const swapId = siblingIds[swapIdx]

  // Assign display_order based on position index
  await Promise.all([
    ctx.db
      .from('org_nodes')
      .update({ display_order: swapIdx, updated_at: new Date().toISOString() })
      .eq('id', nodeId),
    ctx.db
      .from('org_nodes')
      .update({ display_order: idx, updated_at: new Date().toISOString() })
      .eq('id', swapId),
  ])

  revalidateOrgPaths()
  return { error: null }
}

// ─────────────────────────────────────────────
// Ranks & Positions (existing — not migrated)
// ─────────────────────────────────────────────

export async function createRank(name: string): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }
  const { error } = await ctx.db.from('org_ranks').insert({ name, display_order: 999 })
  if (error) {
    const e = error as DbError
    return { error: e.code === '23505' ? '이미 존재하는 직급입니다' : e.message }
  }
  revalidatePath('/admin/org-chart')
  return { error: null }
}

export async function deleteRank(id: number): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }
  const { error } = await ctx.db.from('org_ranks').delete().eq('id', id)
  if (error) return { error: (error as DbError).message }
  revalidatePath('/admin/org-chart')
  return { error: null }
}

export async function createPosition(name: string): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }
  const { error } = await ctx.db.from('org_positions').insert({ name, display_order: 999 })
  if (error) {
    const e = error as DbError
    return { error: e.code === '23505' ? '이미 존재하는 직책입니다' : e.message }
  }
  revalidatePath('/admin/org-chart')
  return { error: null }
}

export async function deletePosition(id: number): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }
  const { error } = await ctx.db.from('org_positions').delete().eq('id', id)
  if (error) return { error: (error as DbError).message }
  revalidatePath('/admin/org-chart')
  return { error: null }
}

export async function updateUserProfile(
  userId: string,
  data: { name: string; rank: string | null; position: string | null },
): Promise<{ error: string | null }> {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '권한 없음' }
  const { error } = await ctx.db
    .from('profiles')
    .update({ name: data.name, rank: data.rank || null, position: data.position || null })
    .eq('id', userId)
  if (error) return { error: (error as DbError).message }
  revalidatePath('/admin/users')
  revalidatePath('/admin/org-chart')
  return { error: null }
}
