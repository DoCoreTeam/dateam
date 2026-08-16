// GET   /api/crm/field-config — 어떤 칸을 AI 가 스스로 채워도 되나
// PATCH /api/crm/field-config — 켜고 끄고, 기준 확신도 조정
//
// 이 설정이 없어서 인박스의 '자동 반영됨' 탭이 구조적으로 영원히 비어 있었다.
// 신뢰의 범위를 정하는 일이라 관리자만.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { listFieldConfigs, setFieldConfig } from '@/lib/crm/services/field-config'
import { CrmError } from '@/lib/crm/domain/errors'

export async function GET() {
  return withCrmApi('ADMIN', async ({ db }) => ({ items: await listFieldConfigs(db) }))
}

export async function PATCH(req: NextRequest) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    const targetType = typeof body.targetType === 'string' ? body.targetType : ''
    const field = typeof body.field === 'string' ? body.field.trim() : ''
    if (!targetType || !field) {
      throw new CrmError('VALIDATION_FAILED', '어느 항목을 설정할지 지정해 주세요.', { field: 'field' })
    }

    await setFieldConfig(session.workspaceId, session.memberId, targetType, field, {
      autoApply: typeof body.autoApply === 'boolean' ? body.autoApply : undefined,
      minConfidence: typeof body.minConfidence === 'number' ? body.minConfidence : undefined,
    })
    return { ok: true }
  })
}
