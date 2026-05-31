import { NextRequest, NextResponse } from 'next/server'
import { authenticatePublicApi, corsHeaders, optionsResponse } from '@/lib/publicApiAuth'
import { createAdminClient } from '@/lib/supabase/server'
import { probabilityForStage } from '@/lib/crm'

interface Ctx { params: Promise<{ id: string }> }

const ALLOWED_FIELDS = [
  'title', 'description', 'stage', 'value', 'close_date', 'next_action',
  'next_action_date', 'account_id', 'contact_id', 'tags', 'lead_type',
  'product', 'fit_score', 'hw_included', 'is_new_deal', 'expected_date',
  'funding_source', 'procurement_status', 'source',
] as const

export async function OPTIONS() {
  return optionsResponse()
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data, error } = await admin.from('deals').select('*, accounts(name)').eq('id', id).maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404, headers: corsHeaders() })
    return NextResponse.json({ success: true, data }, { headers: corsHeaders() })
  } catch (err) {
    console.error('[public/v1/deals/:id GET]', err)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500, headers: corsHeaders() })
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const raw = await request.json()
    const body: Record<string, unknown> = Object.fromEntries(ALLOWED_FIELDS.filter(k => k in raw).map(k => [k, raw[k]]))
    if (typeof body.stage === 'string') body.probability = probabilityForStage(body.stage)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data, error } = await admin.from('deals').update(body).eq('id', id).select().maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404, headers: corsHeaders() })
    return NextResponse.json({ success: true, data }, { headers: corsHeaders() })
  } catch (err) {
    console.error('[public/v1/deals/:id PATCH]', err)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500, headers: corsHeaders() })
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { error } = await admin.from('deals').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true }, { headers: corsHeaders() })
  } catch (err) {
    console.error('[public/v1/deals/:id DELETE]', err)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500, headers: corsHeaders() })
  }
}
