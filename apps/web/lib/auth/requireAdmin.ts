import { redirect } from 'next/navigation'
import { createAdminClient, getRequestUser } from '@/lib/supabase/server'
import type { Profile } from '@/types/database'

export async function requireAdmin() {
  // 같은 요청 안에서 레이아웃·페이지가 이미 물었다면 그 답을 쓴다(요청 스코프 캐시)
  const user = await getRequestUser()

  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const result = await (adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as unknown as Promise<{ data: Pick<Profile, 'role'> | null; error: unknown }>)

  if (result.data?.role !== 'admin') redirect('/dashboard')
}
