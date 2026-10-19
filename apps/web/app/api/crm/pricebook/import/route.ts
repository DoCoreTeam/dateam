// POST /api/crm/pricebook/import — 가격표 파일을 읽어 가져오기 «초안»으로 (관리자)
//
// **저장하지 않는다.** 화면이 원본과 나란히 보여 주고(검증 7), 사람이 「저장」을 누르면 /save 로 간다.
// form: file, target(product|items|labor), productId(다시 올리기면)
// 형식과 크기 검사(1)는 바이트를 읽기 전에 한 번, 서비스가 한 번 더 본다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { MAX_QUOTE_FILE_BYTES } from '@/lib/crm/services/quote-from-file'
import { readPriceSheet } from '@/lib/crm/services/pricebook-import'
import { jsonSafe } from '@/lib/crm/services/json-safe'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

const TARGETS = ['product', 'items', 'labor'] as const

export async function POST(req: NextRequest) {
  return withCrmApi('ADMIN', async ({ session }) => {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      throw new CrmError('VALIDATION_FAILED', '파일을 읽지 못했습니다. 다시 올려 주세요.', { field: 'file' })
    }
    const file = form.get('file')
    if (!(file instanceof File)) throw new CrmError('VALIDATION_FAILED', '가격표 파일을 골라 주세요.', { field: 'file' })
    if (file.size > MAX_QUOTE_FILE_BYTES) {
      throw new CrmError('VALIDATION_FAILED', `파일이 너무 큽니다. ${Math.round(MAX_QUOTE_FILE_BYTES / (1024 * 1024))}MB 이내로 올려 주세요.`, { field: 'file' })
    }
    const t = String(form.get('target') ?? 'product')
    const target = (TARGETS as readonly string[]).includes(t) ? (t as (typeof TARGETS)[number]) : 'product'
    const productId = typeof form.get('productId') === 'string' && form.get('productId') ? String(form.get('productId')) : null
    const result = await readPriceSheet(session.workspaceId, session.memberId, {
      fileName: file.name, mimeType: file.type || null, bytes: new Uint8Array(await file.arrayBuffer()), target, productId,
    })
    return jsonSafe(result)
  })
}
