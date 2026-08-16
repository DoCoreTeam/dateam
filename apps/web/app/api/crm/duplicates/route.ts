// GET  /api/crm/duplicates — 중복 후보 목록 (화면이 사람 판단을 받기 위해 읽는다)
// POST /api/crm/duplicates — 지금 훑어서 후보를 갱신한다
//
// 후보는 **제안일 뿐**이다. 자동으로 합치지 않는다 —
// 어느 쪽이 진짜인지는 데이터가 아니라 맥락이 정하고, 그 맥락은 사람에게만 있다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { scanDuplicates, saveDuplicates, listDuplicates, dismissDuplicate } from '@/lib/crm/services/merge'
import type { MergeTarget } from '@/lib/crm/services/merge'
import { CrmError } from '@/lib/crm/domain/errors'

function readTarget(req: NextRequest): MergeTarget {
  const t = req.nextUrl.searchParams.get('targetType') ?? 'company'
  if (t !== 'company' && t !== 'person') {
    throw new CrmError('VALIDATION_FAILED', '회사 또는 인물만 볼 수 있습니다.', { field: 'targetType' })
  }
  return t
}

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ session }) => {
    const targetType = readTarget(req)
    const db = getCrmDb(session.workspaceId)
    const rows = await listDuplicates(db, targetType)

    // 후보에 이름이 없으면 사람이 무엇을 합치는지 모른다 — id 만 주면 화면이 못 그린다
    const ids = rows.flatMap((r: { aId: string; bId: string }) => [r.aId, r.bId])
    const names = targetType === 'company'
      ? await db.crmCompany.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, domain: true } })
      : await db.crmPerson.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
    const byId = new Map(names.map((n: { id: string }) => [n.id, n]))

    return {
      items: rows
        // 한쪽이 이미 지워졌으면 보여 줄 것이 없다
        .filter((r: { aId: string; bId: string }) => byId.has(r.aId) && byId.has(r.bId))
        .map((r: { id: string; aId: string; bId: string; score: number }) => ({
          id: r.id,
          score: r.score,
          a: byId.get(r.aId),
          b: byId.get(r.bId),
        })),
    }
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const targetType = readTarget(req)
    const db = getCrmDb(session.workspaceId)
    const pairs = await scanDuplicates(db, targetType)
    const saved = await saveDuplicates(session.workspaceId, pairs)
    return { found: pairs.length, saved }
  })
}

/**
 * DELETE /api/crm/duplicates?id=... — "이건 중복 아니에요"
 *
 * 이 경로가 없으면 잘못 잡힌 짝이 **영원히 목록에 남는다**.
 * 사람은 매번 같은 것을 보고 넘기게 되고, 그러면 진짜 중복도 같이 안 보게 된다.
 */
export async function DELETE(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) throw new CrmError('VALIDATION_FAILED', '어느 짝인지 알 수 없습니다.', { field: 'id' })
    await dismissDuplicate(session.workspaceId, id)
    return { ok: true }
  })
}
