import type { NextRequest } from 'next/server'
import { optionsResponse } from '@/lib/publicApiAuth'
import { withPublicCrmApi } from '@/lib/public-api/crm-bridge'
import { getDeal } from '@/lib/crm/services/deal'

// 딜 상세

interface Ctx { params: Promise<{ id: string }> }

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  return withPublicCrmApi('READONLY', request, ({ db }) =>
    getDeal(db, id))
}
