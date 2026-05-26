import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AiUsageDashboard from './AiUsageDashboard'

export default async function AiUsagePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  // role check는 클라이언트에서 API 호출 시 403으로 처리됨
  return <AiUsageDashboard />
}
