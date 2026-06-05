import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import DataQualityDashboard from './DataQualityDashboard'

// 관리자 전용 — 일반 사용자 접근 차단(role=admin만)
export default async function DataQualityPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (createAdminClient() as any).from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') redirect('/dashboard')

  return <DataQualityDashboard />
}
