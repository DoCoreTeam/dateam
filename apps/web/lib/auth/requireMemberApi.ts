import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { Profile } from '@/types/database'

/**
 * 내부 임직원(admin 또는 member) 전용 API 게이트.
 *
 * requireAdminApi 와 대칭이나 member 까지 허용한다. 민감 데이터를 "읽는" 라우트에서 사용:
 * anon·api_user(외부 API 사용자)를 차단하되, 내부 화면을 함께 보는 member 는 통과시킨다.
 * (DB RLS 의 is_member() 와 같은 기준 — 앱 레이어 2중 방어)
 *
 * 쓰기/변이 라우트는 requireMemberApi 가 아니라 requireAdminApi 를 쓴다.
 */
export async function requireMemberApi(): Promise<
  | { user: { id: string; email: string | undefined; role: 'admin' | 'member' }; error: null }
  | { user: null; error: NextResponse }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, error: NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 }) }
  }

  const adminClient = createAdminClient()
  const result = await (adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as unknown as Promise<{ data: Pick<Profile, 'role'> | null; error: unknown }>)

  const role = result.data?.role
  if (role !== 'admin' && role !== 'member') {
    return { user: null, error: NextResponse.json({ error: '권한이 없습니다 (임직원 전용)' }, { status: 403 }) }
  }

  return { user: { id: user.id, email: user.email, role }, error: null }
}
