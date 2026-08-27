import type { NextRequest } from 'next/server'
import { optionsResponse } from '@/lib/publicApiAuth'
import { withPublicCrmApi } from '@/lib/public-api/crm-bridge'
import { getCompany } from '@/lib/crm/services/company'

// 회사 상세 — 없는 id 는 CrmError(NOT_FOUND)로 404 가 된다

interface Ctx { params: Promise<{ id: string }> }

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  return withPublicCrmApi('READONLY', request, ({ db }) =>
    getCompany(db, id))
}
