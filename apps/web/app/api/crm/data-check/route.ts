// POST /api/crm/data-check — 규칙으로 찾고, AI 가 무엇부터인지 고른다
//
// POST 인 이유: AI 를 부르는 일이라 돈이 든다. GET 이면 화면을 열 때마다 돌게 되고,
// 사람이 안 볼 때도 비용이 나간다. 누르는 순간에만 돈다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { checkData } from '@/lib/crm/services/data-check'

export async function POST(_req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => checkData(session.workspaceId))
}
