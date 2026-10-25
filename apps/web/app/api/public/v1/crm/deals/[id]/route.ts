import { dispatchPublicApi } from '@/lib/actions/dispatch'
import type { NextRequest } from 'next/server'
import { optionsResponse } from '@/lib/publicApiAuth'
import { withPublicCrmApi } from '@/lib/public-api/crm-bridge'
import { getDeal, toDealJson } from '@/lib/crm/services/deal'

// 딜 상세

interface Ctx { params: Promise<{ id: string }> }

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  return withPublicCrmApi('READONLY', request, async ({ db }) => toDealJson(await getDeal(db, id)))
}

// 정의 표의 고치기와 삭제는 공개 API 관문으로 (P0158 I07)
export const PATCH = dispatchPublicApi
export const DELETE = dispatchPublicApi
