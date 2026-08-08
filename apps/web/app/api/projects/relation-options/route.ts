import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'

export async function GET() {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await createClient()) as any
  const [{ data: accounts, error: accountError }, { data: deals, error: dealError }] = await Promise.all([
    db.from('accounts').select('id,name').order('name').limit(500),
    db.from('deals').select('id,title,account_id').order('created_at', { ascending: false }).limit(500),
  ])
  if (accountError || dealError) return NextResponse.json({ error: 'CRM 관계 목록을 불러오지 못했습니다' }, { status: 500 })
  return NextResponse.json({ accounts: accounts ?? [], deals: deals ?? [] })
}
