// GET  /api/crm/pricebook/products — 가격 기준 제품 목록 (?q= ?all=1 ?trash=1)
// POST /api/crm/pricebook/products — 새 제품 (관리자)
//
// 정상가를 바꾸는 자리라서 만들기 고치기 지우기는 ADMIN 이다. 단추를 숨기는 것으로 막지 않고 서버가 막는다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { listPriceProducts, countUnsortedItems, createPriceProduct, type ProductInput } from '@/lib/crm/services/pricebook'
import { jsonSafe } from '@/lib/crm/services/json-safe'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db }) => {
    const sp = new URL(req.url).searchParams
    const trash = sp.get('trash') === '1'
    const [items, unsorted] = await Promise.all([
      listPriceProducts(db, { q: sp.get('q'), includeInactive: sp.get('all') === '1', trash }),
      trash ? Promise.resolve(0) : countUnsortedItems(db),
    ])
    return jsonSafe({ items, unsorted })
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    return createPriceProduct(session.workspaceId, session.memberId, body as ProductInput)
  })
}
