/**
 * 자동 반영 설정 — 어떤 칸을 AI 가 스스로 채워도 되나 (dacrm 정정판)
 *
 * **왜 뒤늦게 생겼나**: `crm_ai_field_config` 테이블에 행이 **하나도 없었다.**
 * 그래서 판정이 언제나 `autoApply: false` 를 받고, 모든 제안이 PENDING 으로 떨어졌다 —
 * 인박스의 '자동 반영됨' 탭은 **구조적으로 영원히 빈 화면**이었다.
 *
 * 이 설정이 제품에서 하는 일은 "편해지는 것"이 아니라 **신뢰의 범위를 정하는 것**이다.
 * 회사 지역처럼 틀려도 금방 알아채는 칸은 맡겨도 되고,
 * 금액·단계처럼 틀리면 사업 판단이 흔들리는 칸은 사람이 봐야 한다.
 *
 * 그래서 두 겹으로 막는다.
 *   ① **애초에 못 켜는 칸이 있다**(금액·단계·성사 — 절대규칙 3). 화면에 토글조차 안 띄운다.
 *   ② 켠 칸이라도 **사람이 확정(verified)한 값은 안 덮는다**(절대규칙 2).
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { canConfigureAutoApply } from '../ai/apply-policy.ts'
import { verifiableFields } from './verify.ts'

export interface FieldConfigRow {
  targetType: string
  field: string
  label: string
  autoApply: boolean
  minConfidence: number
  /** 켤 수 있나 — 못 켜는 칸은 이유와 함께 보여 준다 */
  configurable: boolean
  reason?: string
}

/** 화면에 쓰는 말 — 필드명을 그대로 보여 주면 무슨 칸인지 모른다 */
const LABEL: Record<string, string> = {
  name: '이름', domain: '도메인', industry: '산업', region: '지역',
  employeeRange: '규모', descriptionMd: '설명',
  email: '이메일', phone: '전화', title: '직함', companyId: '소속 회사',
  amountMinor: '금액', currency: '통화', closeDate: '마감일', ownerId: '담당자',
}

const TARGETS = ['company', 'person', 'deal'] as const

/** 신뢰도 하한의 허용 범위 — 너무 낮으면 아무 값이나 들어오고, 1.0 은 영영 안 걸린다 */
const MIN_ALLOWED = 0.5
const MAX_ALLOWED = 0.99

export async function listFieldConfigs(db: CrmDb): Promise<FieldConfigRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmAiFieldConfig.findMany({
    select: { targetType: true, field: true, autoApply: true, minConfidence: true },
  }) as { targetType: string; field: string; autoApply: boolean; minConfidence: number }[]

  const byKey = new Map(rows.map((r) => [`${r.targetType}:${r.field}`, r]))
  const out: FieldConfigRow[] = []

  for (const targetType of TARGETS) {
    for (const field of verifiableFields(targetType)) {
      const hit = byKey.get(`${targetType}:${field}`)
      const configurable = canConfigureAutoApply(field)
      out.push({
        targetType, field,
        label: LABEL[field] ?? field,
        autoApply: hit?.autoApply ?? false,
        minConfidence: hit?.minConfidence ?? 0.85,
        configurable,
        // 못 켜는 이유를 안 밝히면 사용자는 "왜 여긴 토글이 없지"를 겪는다
        reason: configurable ? undefined : '이 항목은 사업 판단이 걸려 있어 항상 사람이 확인합니다.',
      })
    }
  }
  return out
}

export async function setFieldConfig(
  workspaceId: string,
  actorId: string | null,
  targetType: string,
  field: string,
  input: { autoApply?: boolean; minConfidence?: number },
): Promise<void> {
  if (!(TARGETS as readonly string[]).includes(targetType)) {
    throw new CrmError('VALIDATION_FAILED', '회사·인물·딜만 설정할 수 있습니다.', { field: 'targetType' })
  }
  if (!verifiableFields(targetType).includes(field)) {
    throw new CrmError('VALIDATION_FAILED', '없는 항목입니다.', { field: 'field' })
  }
  if (input.autoApply === true && !canConfigureAutoApply(field)) {
    // 켤 수 없는 칸을 켜 두면 사용자는 켰다고 믿는데 아무 일도 안 일어난다
    throw new CrmError('VALIDATION_FAILED',
      '이 항목은 사업 판단이 걸려 있어 자동 반영을 켤 수 없습니다.', { field: 'field' })
  }
  if (input.minConfidence !== undefined) {
    const v = input.minConfidence
    if (!Number.isFinite(v) || v < MIN_ALLOWED || v > MAX_ALLOWED) {
      throw new CrmError('VALIDATION_FAILED',
        `기준 확신도는 ${Math.round(MIN_ALLOWED * 100)}%에서 ${Math.round(MAX_ALLOWED * 100)}% 사이여야 합니다.`,
        { field: 'minConfidence' })
    }
  }

  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (tx as any).crmAiFieldConfig.findFirst({
      where: { targetType, field }, select: { id: true, autoApply: true, minConfidence: true },
    })

    const data = {
      autoApply: input.autoApply ?? existing?.autoApply ?? false,
      minConfidence: input.minConfidence ?? existing?.minConfidence ?? 0.85,
    }

    if (existing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmAiFieldConfig.updateMany({ where: { id: existing.id }, data })
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmAiFieldConfig.create({ data: { ...data, targetType, field } })
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'ai.field_config_changed',
      targetType: 'setting', targetId: `${targetType}.${field}`,
      beforeJson: existing ? { autoApply: existing.autoApply, minConfidence: existing.minConfidence } : null,
      afterJson: data,
    })
  })
}
