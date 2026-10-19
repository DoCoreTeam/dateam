// PUT /api/crm/pricebook/products/[id]/rules — 규칙 통째로 바꾸기 (관리자, version 필수)
// 모양이 틀린 규칙은 거절하지 않고 끈 채로 저장한다 — 사유가 화면에 선다
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { replaceRules } from '@/lib/crm/services/pricebook'
import { parseRules } from '@/lib/crm/services/pricebook-input'

type Ctx = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    return replaceRules(session.workspaceId, session.memberId, (await params).id, requireVersion(body), parseRules(body.rules))
  })
}
