import type { NextRequest } from 'next/server'
import { optionsResponse } from '@/lib/publicApiAuth'
import { withPublicCrmApi } from '@/lib/public-api/crm-bridge'
import { getPerson } from '@/lib/crm/services/person'

// 인물 상세

interface Ctx { params: Promise<{ id: string }> }

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  return withPublicCrmApi('READONLY', request, ({ db }) =>
    getPerson(db, id))
}
