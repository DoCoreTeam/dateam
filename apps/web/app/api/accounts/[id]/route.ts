import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'

interface Ctx { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  const supabase = await createClient()

  const raw = await req.json()
  const ALLOWED = [
    'name', 'industry', 'segment', 'size', 'region', 'website', 'phone', 'address',
    'description', 'fit_score', 'fit_reason', 'tags', 'source', 'account_type',
    'gpu_demand_intensity', 'registration_number', 'owner_user_id',
  ] as const
  const body = Object.fromEntries(ALLOWED.filter(k => k in raw).map(k => [k, raw[k]]))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('accounts').update(body).eq('id', id).select().maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('accounts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
