import type { NextRequest } from 'next/server'
import { optionsResponse } from '@/lib/publicApiAuth'
import { withPublicCrmApi, readPublicListQuery } from '@/lib/public-api/crm-bridge'
import { listQuotes } from '@/lib/crm/services/quote'

// 견적 목록

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest) {
  return withPublicCrmApi('READONLY', request, ({ db }) =>
    listQuotes(db, readPublicListQuery(request)))
}
