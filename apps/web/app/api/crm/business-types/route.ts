// GET  /api/crm/business-types — 사업 유형 목록(+ 유형별 딜 수)
// POST /api/crm/business-types — 유형 추가
// PUT  /api/crm/business-types — 순서 바꾸기(한 번에 전부)
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import {
  listBusinessTypes, createBusinessType, reorderBusinessTypes,
} from '@/lib/crm/services/business-type'

export async function GET() {
  // 딜 폼·표·상세가 모두 이 목록을 읽는다 — 읽기는 모든 구성원에게 연다
  return withCrmApi('READONLY', async ({ db }) => ({ items: await listBusinessTypes(db) }))
}

export async function POST(req: NextRequest) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    return createBusinessType(session.workspaceId, session.memberId, body)
  })
}

export async function PUT(req: NextRequest) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req) as { ids?: unknown }
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : []
    return { items: await reorderBusinessTypes(session.workspaceId, session.memberId, ids) }
  })
}
