import type { NextRequest } from 'next/server'
import { optionsResponse } from '@/lib/publicApiAuth'
import { withPublicCrmApi, readPublicListQuery } from '@/lib/public-api/crm-bridge'
import { listPeople } from '@/lib/crm/services/person'

// 인물 목록 — 「담당자」가 아니라 「인물」이다(용어집 §0-2)

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest) {
  return withPublicCrmApi('READONLY', request, ({ db }) =>
    listPeople(db, readPublicListQuery(request)))
}
