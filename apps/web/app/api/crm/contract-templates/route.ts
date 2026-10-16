// GET  /api/crm/contract-templates — 계약서 템플릿 목록
// POST /api/crm/contract-templates — 새 템플릿 (관리자)
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { listContractTemplates, createContractTemplate, type TemplateInput } from '@/lib/crm/services/contract-template'

export async function GET() {
  return withCrmApi('READONLY', async ({ db }) => ({ items: await listContractTemplates(db) }))
}

export async function POST(req: NextRequest) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    return createContractTemplate(session.workspaceId, session.memberId, body as TemplateInput)
  })
}
