// GET  /api/crm/products  — 이름·SKU 검색 (견적 항목 고르기)
// POST /api/crm/products  — 그 자리에서 만들기
//
// 커서 목록이 아니라 **검색 상한**이다. 고르는 모달이 쓰는 API 라서
// "다음 페이지"가 필요한 자리가 아니고, 못 찾으면 이름을 더 치면 된다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import {
  listProducts, createProduct, toProductJson,
  type CreateProductInput,
} from '@/lib/crm/services/product'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db }) => {
    const sp = new URL(req.url).searchParams
    const rows = await listProducts(db, {
      q: sp.get('q'),
      includeInactive: sp.get('all') === '1',
    })
    // BigInt 는 JSON 으로 못 나간다 — 여기서 문자열로 바꾸지 않으면 응답이 500 이 된다
    return { items: rows.map(toProductJson) }
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    // 통화는 본문이 정한다 — 견적을 쓰다 만드는 경로라서 그 견적의 통화를 그대로 따라야 한다
    const made = await createProduct(
      session.workspaceId,
      session.memberId,
      body as unknown as CreateProductInput,
    )
    return toProductJson(made)
  })
}
