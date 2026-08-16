// GET  /api/crm/companies  — 커서 목록
// POST /api/crm/companies  — 생성
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, readListQuery } from '@/lib/crm/api/handler'
import { listCompanies, createCompany, type CompanyInput } from '@/lib/crm/services/company'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db }) => {
    const { cursor, limit, q } = readListQuery(req)
    return listCompanies(db, { cursor, limit, q })
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    return createCompany(session.workspaceId, session.memberId, body as unknown as CompanyInput)
  })
}
