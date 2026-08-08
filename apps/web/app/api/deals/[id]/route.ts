import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { probabilityForStage } from '@/lib/crm'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'

interface Ctx { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  const supabase = await createClient()

  const raw = await req.json()
  const ALLOWED = [
    'title', 'description', 'stage', 'value', 'close_date', 'next_action',
    'next_action_date', 'account_id', 'contact_id', 'tags', 'lead_type',
    'product', 'fit_score', 'hw_included', 'is_new_deal', 'expected_date',
    'funding_source', 'procurement_status', 'source',
  ] as const
  const body = Object.fromEntries(ALLOWED.filter(k => k in raw).map(k => [k, raw[k]]))
  if (typeof body.stage === 'string') body.probability = probabilityForStage(body.stage)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('deals').update(body).eq('id', id).select().maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('deals').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
