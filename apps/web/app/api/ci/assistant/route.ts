import { z } from 'zod'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { runAssistant } from '@/lib/ci/ai/assistant-server'

const Body = z.object({
  message: z.string().trim().min(1).max(2000),
  route: z.string().max(200).optional(),
})

/**
 * AI 어시스턴트. 자연어를 Command로 바꾸고, 안전한 것만 실행한다.
 * guarded 등급은 실행하지 않고 제안만 돌려준다(설계: 02-command-catalog.md).
 */
export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '메시지를 확인해 주세요', parsed.error.issues)

    return ok(await runAssistant({
      workspaceId: session.workspaceId,
      userId: session.userId,
      message: parsed.data.message,
      route: parsed.data.route ?? '/ci',
    }))
  } catch (e) {
    return failUnexpected(e)
  }
}
