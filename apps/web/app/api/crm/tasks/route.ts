// GET  /api/crm/tasks — 커서 목록 (레코드 상세는 scope=open 으로 열린 것만)
// POST /api/crm/tasks — 생성
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, readListQuery } from '@/lib/crm/api/handler'
import { listTasks, createTask, type TaskInput } from '@/lib/crm/services/task'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db }) => {
    const { cursor, limit, q } = readListQuery(req)
    const sp = new URL(req.url).searchParams
    const page = await listTasks(db, {
      cursor, limit, q,
      companyId: sp.get('companyId'),
      personId: sp.get('personId'),
      dealId: sp.get('dealId'),
      status: sp.get('status'),
      scope: sp.get('scope') === 'open' ? 'open' : 'all',
      trash: sp.get('trash') === '1',
    })
    return page
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    return createTask(session.workspaceId, session.memberId, body as unknown as TaskInput)
  })
}
