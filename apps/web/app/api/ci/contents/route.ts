import { ok, failUnexpected } from '@/lib/ci/api'
import { readPaging } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { listContents } from '@/lib/ci/queries/contents'
import type { CiContentFormat, CiPlatform } from '@/lib/ci/types'

/** 수집함 목록. 코퍼스 필터를 걸지 않는다 — 여기서는 inbox 단건도 보여야 한다. */
export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const url = new URL(req.url)
    const { limit, cursor } = readPaging(url)
    const tabParam = url.searchParams.get('tab')
    const tab = tabParam === 'review' || tabParam === 'failed' ? tabParam : 'all'

    const result = await listContents({
      workspaceId: session.workspaceId,
      tab,
      corpusOnly: false,
      topicId: url.searchParams.get('topicId'),
      platform: url.searchParams.get('platform') as CiPlatform | null,
      format: url.searchParams.get('format') as CiContentFormat | null,
      sort: 'recent',
      // 제목뿐 아니라 영상 대사·화면 자막까지 함께 찾는다(마이그 212·213).
      // 숏폼은 제목이 짧아 제목 검색만으로는 사실상 아무것도 못 찾는다.
      q: url.searchParams.get('q'),
      limit,
      cursor,
    })

    return ok(result.items, { total: result.total, cursor: result.cursor })
  } catch (e) {
    return failUnexpected(e)
  }
}
