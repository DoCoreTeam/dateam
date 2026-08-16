// POST /api/crm/merge — 두 레코드를 합친다 (구현명세 §API, DI-10)
// POST /api/crm/merge?undo=1 — 합친 것을 되돌린다 (DI-11)
//
// 병합은 **관리자만** 한다. 되돌릴 수 있게 만들어 두었지만, 되돌릴 수 있다는 것과
// 아무나 눌러도 된다는 것은 다르다 — 그 사이에 남이 만든 기록이 옮겨 다닌다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { mergeRecords, undoMerge } from '@/lib/crm/services/merge'
import type { MergeTarget } from '@/lib/crm/services/merge'
import { CrmError } from '@/lib/crm/domain/errors'

export async function POST(req: NextRequest) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)

    if (req.nextUrl.searchParams.get('undo') === '1') {
      const id = typeof body.mergeLogId === 'string' ? body.mergeLogId.trim() : ''
      if (!id) throw new CrmError('VALIDATION_FAILED', '되돌릴 병합을 지정해 주세요.', { field: 'mergeLogId' })
      await undoMerge(session.workspaceId, session.memberId, id)
      return { undone: true }
    }

    const targetType = body.targetType
    if (targetType !== 'company' && targetType !== 'person') {
      throw new CrmError('VALIDATION_FAILED', '회사 또는 인물만 합칠 수 있습니다.', { field: 'targetType' })
    }
    const survivorId = typeof body.survivorId === 'string' ? body.survivorId.trim() : ''
    const mergedId = typeof body.mergedId === 'string' ? body.mergedId.trim() : ''
    if (!survivorId || !mergedId) {
      throw new CrmError('VALIDATION_FAILED', '남길 쪽과 합칠 쪽을 모두 골라 주세요.', { field: 'survivorId' })
    }

    return mergeRecords(
      session.workspaceId, session.memberId, targetType as MergeTarget, survivorId, mergedId,
    )
  })
}
