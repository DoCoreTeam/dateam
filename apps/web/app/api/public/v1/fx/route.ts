import { NextRequest, NextResponse } from 'next/server'
import { authenticatePublicApi, optionsResponse, requireMemberKey } from '@/lib/publicApiAuth'
import { responseHeaders } from '@/lib/public-api/respond'
import { createAdminClient } from '@/lib/supabase/server'

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error
  // 내부 창구가 requireMemberApi 인 자료다, 외부용 api_user 키는 막는다
  const denied = requireMemberKey(auth.ctx, request)
  if (denied) return denied

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data, error } = await admin
      .from('fx_rates')
      .select('rate_date, usd_krw, source')
      .order('rate_date', { ascending: false })
      .limit(7)

    if (error) throw error

    return NextResponse.json(
      { success: true, data: data ?? [], meta: { total: (data ?? []).length } },
      { headers: responseHeaders({ ctx: auth.ctx, request }) }
    )
  } catch (err) {
    console.error('[public/v1/fx GET]', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: responseHeaders({ ctx: auth.ctx, request }) }
    )
  }
}
