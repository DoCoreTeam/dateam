// GET   /api/crm/settings — 설정 목록 (시크릿은 마스킹만)
// PATCH /api/crm/settings — 값 저장·지우기
//
// 설정은 시스템 동작을 바꾼다 — 관리자만.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { listSettings, setSetting } from '@/lib/crm/services/setting'
import { CrmError } from '@/lib/crm/domain/errors'

export async function GET() {
  return withCrmApi('ADMIN', async ({ db }) => ({ items: await listSettings(db) }))
}

export async function PATCH(req: NextRequest) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    const key = typeof body.key === 'string' ? body.key : ''
    if (!key) throw new CrmError('VALIDATION_FAILED', '설정 키가 필요합니다.', { field: 'key' })
    const value = body.value === null || body.value === undefined ? null : String(body.value)
    await setSetting(session.workspaceId, session.memberId, key, value)
    return { ok: true, key }
  })
}
