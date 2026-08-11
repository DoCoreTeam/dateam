import { ok, failUnexpected, readPaging } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { listContents } from '@/lib/ci/queries/contents'
import { formatBasis, PERCENTILE_MIN_POPULATION } from '@/lib/ci/format/metrics'
import type { CiContentFormat, CiPlatform } from '@/lib/ci/types'

/**
 * 떡상 목록. 모집단은 모니터링 코퍼스로 고정한다(설계서 §7.3).
 * 모집단이 얇으면 카드 대신 '데이터 부족'을 렌더하도록 insufficient를 함께 내려보낸다.
 */
export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const url = new URL(req.url)
    const { limit, cursor } = readPaging(url)
    const windowDays = Number(url.searchParams.get('windowDays') ?? 28) || 28
    const sortParam = url.searchParams.get('sort')
    const sort = sortParam === 'recent' || sortParam === 'velocity' ? sortParam : 'outlier'

    const result = await listContents({
      workspaceId: session.workspaceId,
      corpusOnly: true,
      topicId: url.searchParams.get('topicId'),
      platform: url.searchParams.get('platform') as CiPlatform | null,
      format: url.searchParams.get('format') as CiContentFormat | null,
      windowDays,
      sort,
      limit,
      cursor,
    })

    return ok(result.items, {
      total: result.total,
      cursor: result.cursor,
      population: result.population,
      windowDays,
      insufficient: result.population < PERCENTILE_MIN_POPULATION,
      basisText: formatBasis(windowDays, result.population),
    })
  } catch (e) {
    return failUnexpected(e)
  }
}
