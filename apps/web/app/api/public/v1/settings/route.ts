import { NextRequest, NextResponse } from 'next/server'
import { authenticatePublicApi, corsHeaders, optionsResponse } from '@/lib/publicApiAuth'
import { createAdminClient } from '@/lib/supabase/server'

export async function OPTIONS() {
  return optionsResponse()
}

export async function GET(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any

    const [settingsRes, fxRes] = await Promise.all([
      admin.from('pricing_settings').select('margin_pct, updated_at, updated_by').eq('id', 1).single(),
      admin.from('fx_rates').select('usd_krw, rate_date').order('rate_date', { ascending: false }).limit(1).single(),
    ])

    return NextResponse.json(
      {
        success: true,
        data: {
          margin_pct: settingsRes.data?.margin_pct ?? 18,
          usd_krw: fxRes.data?.usd_krw ?? null,
          fx_date: fxRes.data?.rate_date ?? null,
          updated_at: settingsRes.data?.updated_at ?? null,
          updated_by: settingsRes.data?.updated_by ?? null,
        },
      },
      { headers: corsHeaders() }
    )
  } catch (err) {
    console.error('[public/v1/settings GET]', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: corsHeaders() }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const margin_pct = Number(body.margin_pct)
    if (isNaN(margin_pct) || margin_pct < 0 || margin_pct > 999) {
      return NextResponse.json(
        { success: false, error: 'margin_pct must be a number between 0 and 999' },
        { status: 400, headers: corsHeaders() }
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data, error } = await admin
      .from('pricing_settings')
      .upsert({ id: 1, margin_pct, updated_by: `api:${auth.ctx.keyId}`, updated_at: new Date().toISOString() })
      .select('margin_pct, updated_at, updated_by')
      .single()

    if (error) throw error

    await admin.from('gpu_audit_logs').insert({
      action_type: 'margin_changed',
      actor: `api:${auth.ctx.keyId}`,
      detail: { margin_pct },
    })

    return NextResponse.json(
      { success: true, data },
      { headers: corsHeaders() }
    )
  } catch (err) {
    console.error('[public/v1/settings PATCH]', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: corsHeaders() }
    )
  }
}
