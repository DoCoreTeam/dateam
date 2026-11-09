// GET  /api/crm/contract-modules?kind= — 계약 모듈 목록
// POST /api/crm/contract-modules — 새 모듈 (관리자). 서비스가 역할을 다시 본다
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { listModules, createModule, type ModuleInput } from '@/lib/crm/services/contract-module'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  return withCrmApi('READONLY', async ({ db }) => ({
    items: await listModules(db, { kind: sp.get('kind') ?? undefined }),
  }))
}

export async function POST(req: NextRequest) {
  return withCrmApi('ADMIN', async ({ db, session }) => {
    const body = await readJson(req)
    return createModule(db, session.workspaceId, session.memberId, body as ModuleInput)
  })
}
