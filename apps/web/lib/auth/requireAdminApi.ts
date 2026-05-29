import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { Profile } from '@/types/database'

export async function requireAdminApi(): Promise<
  | { user: { id: string; email: string | undefined }; error: null }
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

  if (result.data?.role !== 'admin') {
    return { user: null, error: NextResponse.json({ error: '권한이 없습니다 (관리자 전용)' }, { status: 403 }) }
  }

  return { user: { id: user.id, email: user.email }, error: null }
}
