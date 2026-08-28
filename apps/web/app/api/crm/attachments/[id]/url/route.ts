// GET /api/crm/attachments/:id/url — 잠깐 열리는 내려받기 주소
//
// **공개 주소를 저장하지 않는 이유**: 한 번 만들면 영원히 열려 있고,
// 그 링크가 메신저에 붙는 순간 우리 원가가 밖으로 나간다.
// 여기서 그때그때 만들면 몇 분 뒤 만료된다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { createAdminClient } from '@/lib/supabase/server'
import { CrmError } from '@/lib/crm/domain/errors'
import { hasCapability } from '@/lib/crm/security/sensitivity'
import { BUCKET } from '@/lib/crm/services/attachment'

/** 5분 — 눌러서 받기에 충분하고, 새어도 곧 죽는다 */
const TTL_SECONDS = 300

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('READONLY', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (db as any).crmAttachment.findFirst({
      where: { id }, select: { fileUrl: true, fileName: true, sensitivity: true },
    }) as { fileUrl: string; fileName: string; sensitivity: string } | null
    if (!row) throw new CrmError('NOT_FOUND', '첨부를 찾을 수 없습니다.')

    if (row.sensitivity === 'RESTRICTED' && !hasCapability({ role: session.role }, 'cost.view')) {
      throw new CrmError('FORBIDDEN', '이 파일은 관리자만 받을 수 있어요.')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createAdminClient() as any
    const { data, error } = await sb.storage.from(BUCKET)
      .createSignedUrl(row.fileUrl, TTL_SECONDS, { download: row.fileName })
    if (error || !data?.signedUrl) throw new CrmError('CONFLICT', '내려받기 주소를 만들지 못했습니다.')

    return { url: data.signedUrl, expiresInSeconds: TTL_SECONDS }
  })
}
