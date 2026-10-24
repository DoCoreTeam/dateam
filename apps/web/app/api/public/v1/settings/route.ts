import { NextRequest } from 'next/server'
import { authenticatePublicApi, optionsResponse, requireAdminKey, requireMemberKey } from '@/lib/publicApiAuth'
import { fail, ok, serverError } from '@/lib/public-api/respond'
import { readJsonBody, INVALID_JSON_MESSAGE } from '@/lib/public-api/read-json'
import { createAdminClient } from '@/lib/supabase/server'
import { withWriteAudit } from '@/lib/public-api/write-audit'

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

    const [settingsRes, fxRes] = await Promise.all([
      admin.from('pricing_settings').select('margin_pct, updated_at, updated_by').eq('id', 1).single(),
      admin.from('fx_rates').select('usd_krw, rate_date').order('rate_date', { ascending: false }).limit(1).single(),
    ])

    return ok(
      {
        margin_pct: settingsRes.data?.margin_pct ?? 18,
        usd_krw: fxRes.data?.usd_krw ?? null,
        fx_date: fxRes.data?.rate_date ?? null,
        updated_at: settingsRes.data?.updated_at ?? null,
        updated_by: settingsRes.data?.updated_by ?? null,
      },
      { ctx: auth.ctx, request },
    )
  } catch (err) {
    return serverError('settings GET', err, { ctx: auth.ctx, request })
  }
}

/** 마진율 허용 범위 (퍼센트) */
const MARGIN_MIN = 0
const MARGIN_MAX = 999

export async function PATCH(request: NextRequest) {
  return withWriteAudit('public.settings.patch', async () => {
    const auth = await authenticatePublicApi(request, { scope: 'admin' })
    if ('error' in auth) return auth.error
    // 내부 창구가 requireAdminApi 인 쓰기다, 키도 같은 선을 지킨다
    const denied = requireAdminKey(auth.ctx, request)
    if (denied) return denied

    try {
      const read = await readJsonBody(request)
      if (!read.ok) return fail(400, INVALID_JSON_MESSAGE, { ctx: auth.ctx, request })
      const body = (read.body ?? {}) as { margin_pct?: unknown }
      const margin_pct = Number(body.margin_pct)
      if (isNaN(margin_pct) || margin_pct < MARGIN_MIN || margin_pct > MARGIN_MAX) {
        return fail(400, '입력값을 확인해 주세요: margin_pct', { ctx: auth.ctx, request })
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

      return ok(data, { ctx: auth.ctx, request })
    } catch (err) {
      return serverError('settings PATCH', err, { ctx: auth.ctx, request })
    }
  })(request, undefined)
}
