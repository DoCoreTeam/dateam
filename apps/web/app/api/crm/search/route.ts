// GET /api/crm/search?q= — CRM 안에서 찾기
//
// 셸의 전역 검색은 호스트 업무 검색으로 간다. CRM 안에서 치면 CRM 을 떠나
// 엉뚱한 결과가 나왔다 — 사람은 지금 보는 것 안에서 찾는다고 기대한다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { searchCrm } from '@/lib/crm/services/search'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db }) => {
    return searchCrm(db, req.nextUrl.searchParams.get('q') ?? '')
  })
}
