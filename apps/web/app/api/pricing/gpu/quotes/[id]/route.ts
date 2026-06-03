import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { assignSupplierToQuote } from '@/lib/gpu/repository'

// PATCH /api/pricing/gpu/quotes/[id] — 공급사 미지정 견적에 공급사 지정 (docs 01 §4)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const { id } = await params

  let body: { supplier_id?: unknown; supplier_name?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const supabase = await createClient()
  const adminClient = createAdminClient()

  const result = await assignSupplierToQuote(supabase, adminClient, id, {
    supplierId: typeof body.supplier_id === 'string' ? body.supplier_id : null,
    supplierName: typeof body.supplier_name === 'string' ? body.supplier_name : null,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient as any).from('gpu_audit_logs').insert({
    actor: auth.user.email ?? auth.user.id,
    action_type: 'quote_supplier_assigned',
    detail: { quote_id: id, supplier_id: result.supplier_id },
  })

  return NextResponse.json({ ok: true, supplier_id: result.supplier_id })
}
