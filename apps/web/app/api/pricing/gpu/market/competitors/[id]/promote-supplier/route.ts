import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { promoteCompetitorToSupplier } from '@/lib/gpu/promote-supplier'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/pricing/gpu/market/competitors/[id]/promote-supplier
//   경쟁사를 "우리 공급사"로 1클릭 지정(공용 로직 lib/gpu/promote-supplier 사용).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: '경쟁사 ID 형식 오류' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const actor = auth.user.email ?? auth.user.id
  const r = await promoteCompetitorToSupplier(db, id, auth.user.id, actor)
  if (!r.ok) {
    const status = r.error === '경쟁사를 찾을 수 없습니다' ? 404 : 500
    return NextResponse.json({ error: r.error }, { status })
  }
  revalidateGpu()
  return NextResponse.json({
    supplier: r.supplier, reused: r.reused, already_linked: r.already_linked, ingested_cost_quotes: r.ingested_cost_quotes,
  })
}
