import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { logoFromWebsite, ensureSupplierAccount } from '@/lib/gpu/supplier-create'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/pricing/gpu/market/competitors/[id]/promote-supplier
//   경쟁사를 "우리 공급사"로 1클릭 지정.
//   - 이미 supplier_id 연결됨 → 멱등 200(기존 반환)
//   - suppliers에 동명 회사 있으면 그 row 재사용(중복 생성 금지)
//   - 없으면 자동생성(source='competitor_link', 이름·색·웹사이트·로고 승계)
//   → competitors.supplier_id 연결 + audit + revalidate
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: '경쟁사 ID 형식 오류' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  // 대상 경쟁사 조회
  const { data: comp, error: compErr } = await db
    .from('competitors')
    .select('id, name, short_name, color, website_url, pricing_url, supplier_id')
    .eq('id', id)
    .maybeSingle()
  if (compErr) {
    console.error('[promote-supplier] competitor lookup', compErr)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }
  if (!comp) {
    return NextResponse.json({ error: '경쟁사를 찾을 수 없습니다' }, { status: 404 })
  }

  // 이미 연결됨 → 멱등 (기존 공급사 반환)
  if (comp.supplier_id) {
    const { data: existingSup } = await db
      .from('suppliers').select('id, name').eq('id', comp.supplier_id).maybeSingle()
    return NextResponse.json({
      supplier: existingSup ?? { id: comp.supplier_id },
      reused: true,
      already_linked: true,
    })
  }

  // 동명 supplier 재사용 (중복 생성 금지) — 대소문자 무시(ilike, comp.name은 신뢰 가능한 DB값)
  let supplierId: string | null = null
  let reused = false
  let autoCreated = false
  const { data: dupSup, error: dupErr } = await db
    .from('suppliers').select('id, name').ilike('name', comp.name).maybeSingle()
  if (dupErr) {
    console.error('[promote-supplier] dup lookup', dupErr)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }
  if (dupSup) {
    supplierId = dupSup.id as string
    reused = true
  } else {
    // 자동생성 — 경쟁사 정보 승계 (website_url 우선, 없으면 pricing_url로 로고 산출)
    const website = (comp.website_url as string | null) || (comp.pricing_url as string | null) || null
    autoCreated = true
    const { data: created, error: insErr } = await db
      .from('suppliers')
      .insert({
        name: comp.name,
        color: comp.color ?? null,
        website,
        logo_url: logoFromWebsite(website),
        source: 'competitor_link',
      })
      .select('id, name')
      .single()
    if (insErr || !created) {
      console.error('[promote-supplier] supplier insert', insErr)
      return NextResponse.json({ error: '공급사 생성 실패' }, { status: 500 })
    }
    supplierId = created.id as string
    // accounts(is_supplier) 링크 — 회사=accounts 통합 (비치명적)
    await ensureSupplierAccount(db, {
      id: supplierId, name: created.name as string, website,
      color: comp.color ?? null, logo_url: logoFromWebsite(website),
    }, auth.user.id)
  }

  // 경쟁사 ↔ 공급사 연결
  const { error: linkErr } = await db
    .from('competitors')
    .update({ supplier_id: supplierId })
    .eq('id', id)
  if (linkErr) {
    console.error('[promote-supplier] link update', linkErr)
    // 보상: 방금 자동생성한 supplier가 고아로 남지 않게 롤백 삭제(재사용분은 보존)
    if (autoCreated && supplierId) {
      await db.from('suppliers').delete().eq('id', supplierId).eq('source', 'competitor_link')
    }
    return NextResponse.json({ error: '연결 실패' }, { status: 500 })
  }

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'market_price_updated',
    detail: {
      op: 'competitor_promoted_supplier',
      competitor_id: id,
      competitor_name: comp.name,
      supplier_id: supplierId,
      reused_existing: reused,
    },
  })

  revalidateGpu()
  return NextResponse.json({
    supplier: { id: supplierId, name: comp.name },
    reused,
    already_linked: false,
  })
}
