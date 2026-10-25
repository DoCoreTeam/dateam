import { dispatchPublicApi } from '@/lib/actions/dispatch'
import type { NextRequest } from 'next/server'
import { optionsResponse } from '@/lib/publicApiAuth'
import { withPublicCrmApi, readPublicListQuery } from '@/lib/public-api/crm-bridge'
import { listDeals, toDealJson } from '@/lib/crm/services/deal'

// 딜 목록 — 「영업기회」가 아니라 「딜」이다(용어집 §0-2)

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest) {
  // 금액 칸이 BigInt 라 웹과 같은 toDealJson 을 지나야 JSON 이 된다 (P0170 I04, 지나지 않아 500 이었다)
  return withPublicCrmApi('READONLY', request, async ({ db }) => {
    const page = await listDeals(db, readPublicListQuery(request))
    return { ...page, items: page.items.map(toDealJson) }
  })
}

// 정의 표의 쓰기는 공개 API 관문으로 (P0158 I07)
export const POST = dispatchPublicApi
