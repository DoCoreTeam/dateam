import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { Profile } from '@/types/database'

export async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const result = await (adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as unknown as Promise<{ data: Pick<Profile, 'role'> | null; error: unknown }>)

  if (result.data?.role !== 'admin') redirect('/dashboard')
}
