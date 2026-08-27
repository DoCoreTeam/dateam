import type { NextRequest } from 'next/server'
import { optionsResponse } from '@/lib/publicApiAuth'
import { withPublicCiList } from '@/lib/public-api/ci-bridge'
import { listChannels } from '@/lib/ci/queries/channels'
import type { CiChannelOwnership } from '@/lib/ci/types'

// 채널 목록 — 내부 /api/ci/channels 와 같은 조회를 부른다(SSOT)

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest) {
  return withPublicCiList('viewer', request, async ({ workspace }) => {
    const ownership = request.nextUrl.searchParams.get('ownership') as CiChannelOwnership | null
    const items = await listChannels(workspace.id, ownership ?? undefined)
    return { items, meta: { total: items.length } }
  })
}
