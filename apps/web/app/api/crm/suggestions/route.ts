// GET /api/crm/suggestions — 인박스 목록 (기본: 만료 전 PENDING)
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { listSuggestions } from '@/lib/crm/services/suggestion'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db }) => {
    const sp = new URL(req.url).searchParams
    const limitRaw = sp.get('limit')
    return listSuggestions(db, {
      limit: limitRaw ? Number(limitRaw) : null,
      status: sp.get('status'),
      targetType: sp.get('targetType'),
      targetId: sp.get('targetId'),
    })
  })
}
