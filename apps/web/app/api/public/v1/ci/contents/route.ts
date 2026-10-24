import type { NextRequest } from 'next/server'
import { optionsResponse } from '@/lib/publicApiAuth'
import { withPublicCiList, readCiListCursor } from '@/lib/public-api/ci-bridge'
import { listContents } from '@/lib/ci/queries/contents'
import { readLimit } from '@/lib/public-api/respond'

// 게시물 목록 — 「콘텐츠」가 아니라 「게시물」이다(용어집 §0-2)

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest) {
  return withPublicCiList('viewer', request, async ({ workspace }) => {
    const sp = request.nextUrl.searchParams
    const days = Number(sp.get('windowDays'))
    const after = readCiListCursor(request)
    const res = await listContents({
      workspaceId: workspace.id,
      limit: readLimit(request),
      keyset: { after },
      topicId: sp.get('topicId') || null,
      ...(Number.isFinite(days) && days > 0 ? { windowDays: Math.floor(days) } : {}),
    })
    return {
      items: res.items,
      // 커서 뒤 쪽의 count 는 남은 줄 수라 전체가 아니다, 모르는 total 은 넣지 않는다 (ListMeta)
      meta: {
        ...(after ? {} : { total: res.total }),
        nextCursor: res.cursor,
        hasMore: res.cursor !== null,
      },
    }
  })
}
