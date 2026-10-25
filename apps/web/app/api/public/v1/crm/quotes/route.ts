import { dispatchPublicApi } from '@/lib/actions/dispatch'
import type { NextRequest } from 'next/server'
import { optionsResponse } from '@/lib/publicApiAuth'
import { withPublicCrmApi, readPublicListQuery } from '@/lib/public-api/crm-bridge'
import { listQuotes, toQuoteJson } from '@/lib/crm/services/quote'
import { withoutPricingFields } from '@/lib/crm/services/quote-pricing-fields'

// 견적 목록

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest) {
  // 공개 모양은 그대로 — 가격 기준 칸(자동으로 채운 값, 조건, 예산)은 밖으로 안 낸다(P0135)
  return withPublicCrmApi('READONLY', request, async ({ db }) => {
    const page = await listQuotes(db, readPublicListQuery(request))
    // 금액 칸이 BigInt 라 웹과 같은 toQuoteJson 을 먼저 지난다 (P0170 I04)
    return { ...page, items: page.items.map((r) => withoutPricingFields(toQuoteJson(r))) }
  })
}

// 정의 표의 쓰기는 공개 API 관문으로 (P0158 I07)
export const POST = dispatchPublicApi
