import { z } from 'zod'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { listChannels, addChannel } from '@/lib/ci/queries/channels'
import type { CiChannelOwnership } from '@/lib/ci/types'

const Body = z.object({
  input: z.string().trim().min(1),
  topicId: z.string().uuid().nullable().optional(),
  monitor: z.boolean().default(true),
})

export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error
    const ownership = new URL(req.url).searchParams.get('ownership') as CiChannelOwnership | null
    return ok(await listChannels(session.workspaceId, ownership ?? undefined))
  } catch (e) {
    return failUnexpected(e)
  }
}

export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '입력값을 확인해 주세요', parsed.error.issues)

    const result = await addChannel({
      workspaceId: session.workspaceId,
      urlOrHandle: parsed.data.input,
      topicId: parsed.data.topicId ?? null,
      monitor: parsed.data.monitor,
    })

    if (!result.ok) {
      if (result.code === 'PLAN_LIMIT_EXCEEDED') {
        return fail('PLAN_LIMIT_EXCEEDED', result.message, {
          limit: result.limit, current: result.current, metric: 'tracked_channels',
        })
      }
      return fail('VALIDATION_FAILED', result.message)
    }
    return ok(result.item)
  } catch (e) {
    return failUnexpected(e)
  }
}
