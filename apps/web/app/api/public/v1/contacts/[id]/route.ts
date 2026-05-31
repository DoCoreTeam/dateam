import { NextRequest, NextResponse } from 'next/server'
import { authenticatePublicApi, corsHeaders, optionsResponse } from '@/lib/publicApiAuth'
import { createAdminClient } from '@/lib/supabase/server'

interface Ctx { params: Promise<{ id: string }> }

const ALLOWED_FIELDS = ['account_id', 'name', 'title', 'department', 'email', 'phone', 'mobile', 'linkedin', 'notes', 'business_card_drive_id', 'role'] as const

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
    const { data, error } = await admin.from('contacts').select('*, accounts(name)').eq('id', id).maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404, headers: corsHeaders() })
    return NextResponse.json({ success: true, data }, { headers: corsHeaders() })
  } catch (err) {
    console.error('[public/v1/contacts/:id GET]', err)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500, headers: corsHeaders() })
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await params
    const raw = await request.json() as Record<string, unknown>
    const body = Object.fromEntries(ALLOWED_FIELDS.filter(k => k in raw).map(k => [k, raw[k]]))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data, error } = await admin.from('contacts').update(body).eq('id', id).select().maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404, headers: corsHeaders() })
    return NextResponse.json({ success: true, data }, { headers: corsHeaders() })
  } catch (err) {
    console.error('[public/v1/contacts/:id PATCH]', err)
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
    const { error } = await admin.from('contacts').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true }, { headers: corsHeaders() })
  } catch (err) {
    console.error('[public/v1/contacts/:id DELETE]', err)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500, headers: corsHeaders() })
  }
}
