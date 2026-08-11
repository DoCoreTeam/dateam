// lib/ci/workspace.ts — 활성 워크스페이스 해석 (서버 전용)
// 쿠키에 담긴 선택값 → 유효성 검사 → 없으면 소속 워크스페이스 중 첫 번째.
// 화면마다 워크스페이스를 다시 고르는 로직을 짜지 않는다.

import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import type { CiMemberRole } from './types.ts'

export const CI_WORKSPACE_COOKIE = 'ci_ws'

export interface CiWorkspaceRef {
  id: string
  name: string
  slug: string
  role: CiMemberRole
}

interface MembershipRow {
  workspace_id: string
  role: CiMemberRole
  ci_workspaces: { id: string; name: string; slug: string; deleted_at: string | null } | null
}

/** 사용자가 속한 워크스페이스 전체. 삭제된 것은 제외. */
export async function listCiWorkspaces(userId: string): Promise<CiWorkspaceRef[]> {
  const adminClient = createAdminClient()
  const result = await ((adminClient as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => Promise<{ data: MembershipRow[] | null }>
      }
    }
  })
    .from('ci_workspace_members')
    .select('workspace_id, role, ci_workspaces(id, name, slug, deleted_at)')
    .eq('user_id', userId))

  return (result.data ?? [])
    .filter((r) => r.ci_workspaces && r.ci_workspaces.deleted_at === null)
    .map((r) => ({
      id: r.ci_workspaces!.id,
      name: r.ci_workspaces!.name,
      slug: r.ci_workspaces!.slug,
      role: r.role,
    }))
}

/**
 * 활성 워크스페이스를 고른다.
 * 쿠키 값이 실제 소속과 맞지 않으면 무시한다 — 쿠키를 신뢰하지 않는다.
 */
export async function resolveActiveWorkspace(userId: string): Promise<CiWorkspaceRef | null> {
  const all = await listCiWorkspaces(userId)
  if (all.length === 0) return null

  const store = await cookies()
  const preferred = store.get(CI_WORKSPACE_COOKIE)?.value
  const matched = preferred ? all.find((w) => w.id === preferred) : undefined
  return matched ?? all[0]
}
