import { z } from 'zod'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { getSuccessEvidence } from '@/lib/ci/queries/success-evidence'
import { buildEditPoints } from '@/lib/ci/production/edit-points'

/**
 * 브라우저가 뽑은 신호 + 우리가 모은 근거 → 편집점.
 *
 * 영상 자체는 받지 않는다. 숫자만 온다 — 원본은 사용자 기기를 벗어나지 않는다.
 */
const Body = z.object({
  durationSec: z.number().positive().max(24 * 3600),
  framesSampled: z.number().int().nonnegative().default(0),
  audioAnalyzed: z.boolean().default(false),
  sceneChanges: z.array(z.object({
    atSec: z.number().nonnegative(), score: z.number(),
  })).max(2000).default([]),
  silences: z.array(z.object({
    startSec: z.number().nonnegative(), endSec: z.number().nonnegative(),
  })).max(2000).default([]),
  loudPeaks: z.array(z.object({
    atSec: z.number().nonnegative(), level: z.number(),
  })).max(2000).default([]),
})

export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', '분석 신호를 확인해 주세요', parsed.error.issues)
    }

    const evidence = await getSuccessEvidence(session.workspaceId)
    const points = buildEditPoints(parsed.data, evidence)

    return ok({ points, evidence })
  } catch (e) {
    return failUnexpected(e)
  }
}
