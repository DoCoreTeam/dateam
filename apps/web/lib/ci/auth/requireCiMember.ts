// lib/ci/auth/requireCiMember.ts — CI 워크스페이스 권한 게이트 (서버 전용)
// 설계: 00-integration-decisions.md §1-2
// 미들웨어는 인증만 본다. 워크스페이스 멤버십·역할은 반드시 서버에서 판정한다.
// 클라이언트 단독 게이팅 금지.

import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ciRoleAtLeast, type CiMemberRole } from '../types.ts'

export interface CiSession {
  userId: string
  email: string | undefined
  workspaceId: string
  role: CiMemberRole
}

async function lookupMembership(
  userId: string,
  workspaceId: string,
): Promise<CiMemberRole | null> {
  const adminClient = createAdminClient()
  const result = await ((adminClient as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            maybeSingle: () => Promise<{ data: { role: CiMemberRole } | null }>
          }
        }
      }
    }
  })
    .from('ci_workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle())

  return result.data?.role ?? null
}

/** 페이지용. 실패 시 리다이렉트한다. */
export async function requireCiMember(
  workspaceId: string,
  minRole: CiMemberRole = 'viewer',
): Promise<CiSession> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const role = await lookupMembership(user.id, workspaceId)
  if (!role) redirect('/ci')                 // 비멤버 → CI 진입점(워크스페이스 선택)
  if (!ciRoleAtLeast(role, minRole)) redirect('/ci')

  return { userId: user.id, email: user.email, workspaceId, role }
}

/** API 라우트용. 실패 시 NextResponse를 돌려준다. */
export async function requireCiMemberApi(
  workspaceId: string | null,
  minRole: CiMemberRole = 'viewer',
): Promise<
  | { session: CiSession; error: null }
  | { session: null; error: NextResponse }
> {
  if (!workspaceId) {
    return {
      session: null,
      error: NextResponse.json(
        { success: false, error: { code: 'WORKSPACE_REQUIRED', message: '워크스페이스를 지정해 주세요' } },
        { status: 400 },
      ),
    }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return {
      session: null,
      error: NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다' } },
        { status: 401 },
      ),
    }
  }

  const role = await lookupMembership(user.id, workspaceId)
  if (!role || !ciRoleAtLeast(role, minRole)) {
    return {
      session: null,
      error: NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: '이 워크스페이스에 대한 권한이 없습니다' } },
        { status: 403 },
      ),
    }
  }

  return { session: { userId: user.id, email: user.email, workspaceId, role }, error: null }
}

/** 요청에서 워크스페이스 ID를 뽑는다. 헤더 우선, 쿼리 파라미터 허용. */
export function workspaceIdFromRequest(req: Request): string | null {
  const header = req.headers.get('X-CI-Workspace')
  if (header) return header
  try {
    return new URL(req.url).searchParams.get('workspaceId')
  } catch {
    return null
  }
}
