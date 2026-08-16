/**
 * 필드 확정 — "이 값은 내가 확인했다" (dacrm 정정판, 절대규칙 2)
 *
 * **왜 뒤늦게 생겼나**: 판정 로직(`apply-policy.ts:88`)은 처음부터
 * "`verifiedFields` 에 있는 필드는 어떤 confidence 에서도 AI 가 못 덮는다"를 구현하고 있었다.
 * 그런데 **그 목록에 값을 넣는 경로가 없었다.** 화면 어디에도 확정 버튼이 없어서
 * 판정 함수는 언제나 빈 배열을 받았다 — 제품의 핵심 약속이 한 번도 실행되지 않았다.
 *
 * 이 파일이 그 스위치다.
 *
 * 설계에서 중요한 것 둘:
 *   ① **되돌릴 수 있다.** 잘못 확정했으면 풀 수 있어야 한다. 못 풀면 아무도 안 누른다.
 *   ② **필드 단위다.** 레코드 전체를 잠그면 한 칸 때문에 나머지 자동 보강까지 죽는다.
 */

import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { canConfigureAutoApply } from '../ai/apply-policy.ts'

/** 확정할 수 있는 대상 — 판정이 참조하는 세 모델과 같아야 한다 */
const MODEL: Record<string, string> = {
  company: 'crmCompany',
  person: 'crmPerson',
  deal: 'crmDeal',
}

/**
 * 확정할 수 있는 필드.
 *
 * 아무 필드나 받으면 오타가 조용히 저장되고, 그 오타는 아무것도 잠그지 않는다.
 * "잠갔다고 생각했는데 안 잠긴" 상태가 가장 나쁘다.
 */
const FIELDS: Record<string, readonly string[]> = {
  company: ['name', 'domain', 'industry', 'region', 'employeeRange', 'descriptionMd'],
  person: ['name', 'email', 'phone', 'title', 'companyId'],
  deal: ['name', 'amountMinor', 'currency', 'closeDate', 'ownerId'],
}

export function verifiableFields(targetType: string): readonly string[] {
  return FIELDS[targetType] ?? []
}

function assertTarget(targetType: string, field: string): void {
  if (!MODEL[targetType]) {
    throw new CrmError('VALIDATION_FAILED', '회사·인물·딜만 확정할 수 있습니다.', { field: 'targetType' })
  }
  if (!verifiableFields(targetType).includes(field)) {
    throw new CrmError('VALIDATION_FAILED', '이 항목은 확정 대상이 아닙니다.', { field: 'field' })
  }
  /**
   * 금액·단계처럼 **애초에 자동 반영이 금지된 필드**는 확정할 이유가 없다.
   * 잠글 것이 없는데 잠금 버튼을 두면 사용자는 그 버튼이 무슨 일을 하는지 오해한다.
   */
  if (!canConfigureAutoApply(field)) {
    throw new CrmError('VALIDATION_FAILED',
      '이 항목은 원래 AI가 자동으로 바꾸지 않습니다. 따로 확정하지 않아도 됩니다.', { field: 'field' })
  }
}

function currentList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
}

export interface VerifyResult {
  verifiedFields: string[]
}

/**
 * 확정하거나 푼다.
 *
 * 같은 함수로 둘 다 하는 이유: 화면은 토글 하나다.
 * 켜기/끄기를 다른 API 로 두면 화면이 상태를 추측해서 부르게 되고, 그때 어긋난다.
 */
export async function setFieldVerified(
  workspaceId: string,
  actorId: string | null,
  targetType: string,
  targetId: string,
  field: string,
  verified: boolean,
): Promise<VerifyResult> {
  assertTarget(targetType, field)
  const model = MODEL[targetType]

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (tx as any)[model].findFirst({
      where: { id: targetId }, select: { verifiedFields: true },
    })
    if (!row) throw new CrmError('NOT_FOUND', '레코드를 찾을 수 없습니다.')

    const before = currentList(row.verifiedFields)
    const after = verified
      ? Array.from(new Set([...before, field]))
      : before.filter((f) => f !== field)

    // 아무것도 안 바뀌면 쓰지 않는다 — 같은 값을 다시 써서 감사 로그를 늘리지 않는다
    if (before.length === after.length && before.every((f) => after.includes(f))) {
      return { verifiedFields: after }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any)[model].updateMany({
      where: { id: targetId },
      data: { verifiedFields: after as never },
    })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId,
      action: verified ? 'field.verified' : 'field.unverified',
      targetType, targetId,
      beforeJson: { verifiedFields: before },
      afterJson: { verifiedFields: after, field },
    })

    return { verifiedFields: after }
  })
}

/** 화면이 토글 상태를 그리려면 지금 무엇이 확정돼 있는지 알아야 한다 */
export async function listVerified(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  targetType: string,
  targetId: string,
): Promise<string[]> {
  const model = MODEL[targetType]
  if (!model) return []
  const row = await db[model].findFirst({ where: { id: targetId }, select: { verifiedFields: true } })
  return currentList(row?.verifiedFields)
}
