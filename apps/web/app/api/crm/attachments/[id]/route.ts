// DELETE /api/crm/attachments/:id — 첨부 지우기 (파일도 함께)
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { createAdminClient } from '@/lib/supabase/server'
import { deleteAttachment, BUCKET } from '@/lib/crm/services/attachment'

type Ctx = { params: Promise<{ id: string }> }

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    await deleteAttachment(session.workspaceId, session.memberId, id, async (path) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = createAdminClient() as any
      await sb.storage.from(BUCKET).remove([path])
    })
    return { ok: true }
  })
}
