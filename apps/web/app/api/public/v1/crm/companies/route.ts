import { dispatchPublicApi } from '@/lib/actions/dispatch'
import type { NextRequest } from 'next/server'
import { optionsResponse } from '@/lib/publicApiAuth'
import { withPublicCrmApi, readPublicListQuery } from '@/lib/public-api/crm-bridge'
import { listCompanies } from '@/lib/crm/services/company'

// 회사 목록 — 내부 /api/crm/companies 와 같은 서비스를 부른다(SSOT)

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest) {
  return withPublicCrmApi('READONLY', request, ({ db }) =>
    listCompanies(db, readPublicListQuery(request)))
}

// 정의 표의 쓰기는 공개 API 관문으로 (P0158 I07)
export const POST = dispatchPublicApi
