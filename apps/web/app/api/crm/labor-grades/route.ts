// GET  /api/crm/labor-grades — 인건비 등급 목록
// POST /api/crm/labor-grades — 등급 추가
//
// **단가가 대외비다.** 「중급 소프트웨어 엔지니어 월 800만원」이 새어 나가면
// 우리 원가 구조가 그대로 드러난다 — 그래서 목록조차 `cost.view` 가 있어야 준다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { CrmError } from '@/lib/crm/domain/errors'
import { hasCapability } from '@/lib/crm/security/sensitivity'
import { toMinor } from '@/lib/crm/domain/money'
import { withCrmTx } from '@/lib/crm/db/tx'
import { writeAudit } from '@/lib/crm/db/audit'

const SELECT = {
  id: true, name: true, roleLabel: true, costPerMmMinor: true, pricePerMmMinor: true,
  currency: true, position: true, isActive: true,
} as const

export async function GET() {
  return withCrmApi('READONLY', async ({ session }) => {
    if (!hasCapability({ role: session.role }, 'cost.view')) {
      throw new CrmError('FORBIDDEN', '인건비 단가는 관리자만 볼 수 있어요.')
    }
    const db = getCrmDb(session.workspaceId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (db as any).crmLaborGrade.findMany({
      where: { isActive: true }, select: SELECT, orderBy: [{ position: 'asc' }, { name: 'asc' }],
    }) as { costPerMmMinor: bigint; pricePerMmMinor: bigint | null }[]
    return {
      items: rows.map((r) => ({
        ...r,
        costPerMmMinor: r.costPerMmMinor.toString(),
        pricePerMmMinor: r.pricePerMmMinor === null ? null : r.pricePerMmMinor.toString(),
      })),
    }
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) throw new CrmError('VALIDATION_FAILED', '등급 이름을 입력해 주세요.', { field: 'name' })

    return withCrmTx(session.workspaceId, async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = await (tx as any).crmLaborGrade.create({
        data: {
          workspaceId: session.workspaceId,
          name,
          roleLabel: typeof body.roleLabel === 'string' ? body.roleLabel.trim() || null : null,
          costPerMmMinor: toMinor(body.costPerMmMinor as string | number | null),
          pricePerMmMinor: body.pricePerMmMinor ? toMinor(body.pricePerMmMinor as string | number) : null,
          position: Number(body.position ?? 0) || 0,
        },
        select: SELECT,
      }) as { id: string; costPerMmMinor: bigint; pricePerMmMinor: bigint | null }
      await writeAudit(tx, {
        actorType: 'HUMAN', actorId: session.memberId, action: 'labor_grade.created',
        targetType: 'labor_grade', targetId: row.id, afterJson: { name },
      })
      return {
        ...row,
        costPerMmMinor: row.costPerMmMinor.toString(),
        pricePerMmMinor: row.pricePerMmMinor === null ? null : row.pricePerMmMinor.toString(),
      }
    })
  })
}
