// 마감 저장 — 목표와 같은 자리(워크스페이스 설정)에 JSON 으로 넣는다
//
// **새 표를 만들지 않는다.** 운영 DB 스키마 변경은 되돌릴 수 없어 승인이 필요하다.
// 형태를 바꿔 승인 없이 갈 수 있으면 그렇게 한다(목표가 이미 같은 길로 갔다).
//
// 검증은 순수 선언(`domain/close.ts`)이 한다 — 화면이 막아도 API 로 들어온다.

import type { Prisma } from '@prisma/client'
import type { CrmDb } from '../db/client.ts'
import { writeAudit } from '../db/audit.ts'
import { validateCloses, CLOSE_SETTING_KEY, type CloseRecord } from '../domain/close.ts'

export { CLOSE_SETTING_KEY }

function parse(raw: unknown): CloseRecord[] {
  try {
    return validateCloses(raw)
  } catch {
    // 읽기는 던지지 않는다 — 마감을 못 읽었다고 리포트가 통째로 안 뜨면 그게 더 큰 사고다
    return []
  }
}

export async function loadCloses(db: CrmDb | Prisma.TransactionClient): Promise<CloseRecord[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (db as any).crmAppSetting.findFirst({
      where: { key: CLOSE_SETTING_KEY },
      select: { valueJson: true },
    })
    return parse(row?.valueJson)
  } catch {
    return []
  }
}

/**
 * 마감을 저장한다.
 *
 * **확정은 되돌릴 수 없다.** 그래서 감사 기록에 이전 상태를 통째로 남긴다 —
 * 「누가 언제 무엇을 확정했나」를 못 대답하면 그 숫자는 보고에 못 쓴다.
 */
export async function saveCloses(
  db: CrmDb,
  runTx: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>,
  raw: unknown,
  actorId: string | null,
): Promise<CloseRecord[]> {
  const next = validateCloses(raw)

  return runTx(async (tx) => {
    const before = await loadCloses(tx)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyTx = tx as any
    const existing = await anyTx.crmAppSetting.findFirst({
      where: { key: CLOSE_SETTING_KEY },
      select: { id: true },
    })
    if (existing) {
      await anyTx.crmAppSetting.update({
        where: { id: existing.id },
        data: { valueJson: next as unknown as Prisma.InputJsonValue, updatedById: actorId },
      })
    } else {
      await anyTx.crmAppSetting.create({
        data: {
          scope: 'WORKSPACE',
          key: CLOSE_SETTING_KEY,
          valueJson: next as unknown as Prisma.InputJsonValue,
          description: '영업 리포트 마감',
          updatedById: actorId,
        },
      })
    }

    await writeAudit(tx, {
      actorType: 'HUMAN',
      actorId,
      action: 'setting.updated',
      targetType: 'setting',
      targetId: CLOSE_SETTING_KEY,
      beforeJson: { closes: before },
      afterJson: { closes: next },
    })
    return next
  })
}
