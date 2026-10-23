// GET /api/public/v1/me — 이 키가 누구로 무엇을 할 수 있는지 (P0158 I08), teamda auth status 가 읽는다
import type { NextRequest } from 'next/server'
import { authenticatePublicApi, optionsResponse, remainingThisMinute } from '@/lib/publicApiAuth'
import { ok } from '@/lib/public-api/respond'

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest) {
  // 범위가 무엇이든 자기 자신은 볼 수 있다, 만료와 폐기는 여기서도 막힌다
  const auth = await authenticatePublicApi(request, { deferScope: true })
  if ('error' in auth) return auth.error
  const { ctx } = auth
  return ok({
    userId: ctx.userId,
    role: ctx.role,
    keyId: ctx.keyId,
    keyName: ctx.keyName,
    scopes: ctx.scopes,
    rateLimitPerMinute: ctx.rateLimitPerMinute,
    // 만료일과 이번 분 남은 한도, 키 값과 해시는 싣지 않는다 (P0162 I04)
    expiresAt: ctx.expiresAt,
    remainingThisMinute: remainingThisMinute(ctx),
  }, { ctx, request })
}
