import { dispatchPublicApi } from '@/lib/actions/dispatch'
import type { NextRequest } from 'next/server'
import { optionsResponse } from '@/lib/publicApiAuth'
import { withPublicCrmApi, readPublicListQuery } from '@/lib/public-api/crm-bridge'
import { listDeals } from '@/lib/crm/services/deal'

// 딜 목록 — 「영업기회」가 아니라 「딜」이다(용어집 §0-2)

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest) {
  return withPublicCrmApi('READONLY', request, ({ db }) =>
    listDeals(db, readPublicListQuery(request)))
}

// 정의 표의 쓰기는 공개 API 관문으로 (P0158 I07)
export const POST = dispatchPublicApi
