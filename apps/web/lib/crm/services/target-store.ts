// 목표 저장 — 이미 있는 워크스페이스 설정에 JSON 으로 넣는다
//
// **새 표를 만들지 않는다.** 운영 DB 스키마 변경은 되돌리기 어렵다.
// 형태를 바꿔 승인 없이 갈 수 있으면 그렇게 한다(자동화 규칙이 이미 같은 길로 갔다).
// 그래서 이 기능에는 **마이그레이션이 없다.**
//
// 값 검증은 순수 선언(`domain/target.ts`)이 한다 — 화면이 막아도 API 로 들어온다.

import type { Prisma } from '@prisma/client'
import type { CrmDb } from '../db/client.ts'
import { writeAudit } from '../db/audit.ts'
import { validateTargets, type TargetSpec } from '../domain/target.ts'

/** 목표를 담아 두는 설정 키 — 워크스페이스마다 하나 */
export const TARGET_SETTING_KEY = 'report.targets'

function parse(raw: unknown): TargetSpec[] {
  try {
    return validateTargets(raw)
  } catch {
    // 읽기는 던지지 않는다 — 목표를 못 읽었다고 리포트가 통째로 안 뜨면 그게 더 큰 사고다
    return []
  }
}

/**
 * 이 워크스페이스의 목표를 읽는다.
 *
 * 없으면 빈 배열이다. **0 을 만들어 내지 않는다** — 목표 0원과 목표 없음은 다른 사실이고,
 * 화면은 후자를 「설정하기」로 그려야 한다.
 */
export async function loadTargets(db: CrmDb | Prisma.TransactionClient): Promise<TargetSpec[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (db as any).crmAppSetting.findFirst({
      where: { key: TARGET_SETTING_KEY },
      select: { valueJson: true },
    })
    return parse(row?.valueJson)
  } catch {
    return []
  }
}

/**
 * 목표를 저장한다.
 *
 * **조용히 버리지 않는다** — 검증이 던지면 그대로 올라간다. 사람이 만든 목표가
 * 사라지면 「저장했는데 없다」가 되고, 그때부터 이 화면을 아무도 안 믿는다.
 *
 * 바뀐 사실은 감사 기록에 남는다 — 목표가 바뀌면 지난 달성률의 뜻도 바뀐다.
 */
export async function saveTargets(
  db: CrmDb,
  runTx: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>,
  raw: unknown,
  actorId: string | null,
): Promise<TargetSpec[]> {
  const next = validateTargets(raw)

  return runTx(async (tx) => {
    const before = await loadTargets(tx)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyTx = tx as any
    const existing = await anyTx.crmAppSetting.findFirst({
      where: { key: TARGET_SETTING_KEY },
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
          key: TARGET_SETTING_KEY,
          valueJson: next as unknown as Prisma.InputJsonValue,
          description: '영업 리포트 목표',
          updatedById: actorId,
        },
      })
    }

    await writeAudit(tx, {
      actorType: 'HUMAN',
      actorId,
      action: 'setting.updated',
      targetType: 'setting',
      targetId: TARGET_SETTING_KEY,
      beforeJson: { targets: before },
      afterJson: { targets: next },
    })
    return next
  })
}
