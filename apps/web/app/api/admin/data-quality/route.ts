import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'

// GET /api/admin/data-quality — 관리자 전용 데이터 품질 메트릭. get_data_quality_metrics() RPC(SSOT).
export async function GET() {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (createAdminClient() as any).rpc('get_data_quality_metrics')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ metrics: data })
}
