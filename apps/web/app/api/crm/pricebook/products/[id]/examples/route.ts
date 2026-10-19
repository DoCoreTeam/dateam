// PUT /api/crm/pricebook/products/[id]/examples — 계산 예시 저장 (관리자, version 필수)
// 예시 금액은 문자열 정수(원)로 받는다. 미리 계산이 이 값과 어긋나면 화면이 짚는다
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { saveExamples } from '@/lib/crm/services/pricebook'
import { parseConditions } from '@/lib/crm/services/pricebook-input'
import { CrmError } from '@/lib/crm/domain/errors'

type Ctx = { params: Promise<{ id: string }> }

function minor(v: unknown): bigint {
  const s = String(v ?? '').replace(/,/g, '').trim()
  if (!/^\d+$/.test(s)) throw new CrmError('VALIDATION_FAILED', '예시 금액은 0 이상의 정수(원)여야 해요.')
  return BigInt(s)
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    const list = Array.isArray(body.examples) ? body.examples.slice(0, 20) : []
    const examples = list.map((e: Record<string, unknown>) => ({
      label: String(e.label ?? '').slice(0, 300),
      conditions: parseConditions(e.conditions) ?? { picked: [], gpus: [], nodes: null, training: null, companyKind: null, discount: 'none' as const },
      expectOnceMinor: minor(e.expectOnceMinor),
      expectAnnualMinor: minor(e.expectAnnualMinor),
      expectTcoMinor: e.expectTcoMinor === null || e.expectTcoMinor === undefined || e.expectTcoMinor === '' ? null : minor(e.expectTcoMinor),
    }))
    await saveExamples(session.workspaceId, session.memberId, (await params).id, requireVersion(body), examples)
    return { ok: true }
  })
}
