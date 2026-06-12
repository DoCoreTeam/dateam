import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { logoFromWebsite, ensureSupplierAccount } from '@/lib/gpu/supplier-create'

export async function GET() {
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data: suppliers, error } = await db
      .from('suppliers')
      .select('id, name, location, color, contact, country, website, description, logo_url, source, created_at')
      .order('name')

    if (error) throw error

    // Attach stats: active quotes count, lowest count, last received
    const supplierIds = (suppliers ?? []).map((s: Record<string, unknown>) => s.id as string)

    const [activeRes, lowestRes] = await Promise.all([
      supplierIds.length > 0
        ? db
            .from('supply_quotes')
            .select('supplier_id')
            .in('supplier_id', supplierIds)
            .eq('status', 'confirmed')
        : Promise.resolve({ data: [] }),
      supplierIds.length > 0
        ? db
            .from('v_lowest_quotes')
            .select('supplier_id')
            .in('supplier_id', supplierIds)
        : Promise.resolve({ data: [] }),
    ])

    const activeMap = new Map<string, number>()
    for (const q of activeRes.data ?? []) {
      const sid = (q as Record<string, unknown>).supplier_id as string
      activeMap.set(sid, (activeMap.get(sid) ?? 0) + 1)
    }

    const lowestMap = new Map<string, number>()
    for (const q of lowestRes.data ?? []) {
      const sid = (q as Record<string, unknown>).supplier_id as string
      lowestMap.set(sid, (lowestMap.get(sid) ?? 0) + 1)
    }

    // Last received per supplier
    const lastRes = await (supplierIds.length > 0
      ? db
          .from('supply_quotes')
          .select('supplier_id, received_at')
          .in('supplier_id', supplierIds)
          .order('received_at', { ascending: false })
      : Promise.resolve({ data: [] }))

    // 경쟁사 시장가 인입(market_link) 원가 견적이 있는 공급사 — 연계 배지
    const marketLinkRes = await (supplierIds.length > 0
      ? db
          .from('supply_quotes')
          .select('supplier_id')
          .in('supplier_id', supplierIds)
          .eq('status', 'confirmed')
          .eq('price_type', 'cost')
          .eq('source_format', 'market_link')
          .is('deleted_at', null)
      : Promise.resolve({ data: [] }))
    const marketLinkSet = new Set<string>()
    for (const q of marketLinkRes.data ?? []) {
      const sid = (q as Record<string, unknown>).supplier_id as string
      if (sid) marketLinkSet.add(sid)
    }

    // 경쟁사 겸업: competitors.supplier_id 가 이 공급사를 가리키면 "경쟁사 겸업"
    const compLinkRes = await (supplierIds.length > 0
      ? db
          .from('competitors')
          .select('name, supplier_id')
          .in('supplier_id', supplierIds)
      : Promise.resolve({ data: [] }))
    const compNameMap = new Map<string, string>()
    for (const c of compLinkRes.data ?? []) {
      const row = c as Record<string, unknown>
      const sid = row.supplier_id as string
      if (sid && !compNameMap.has(sid)) compNameMap.set(sid, row.name as string)
    }

    const lastMap = new Map<string, string>()
    for (const q of lastRes.data ?? []) {
      const row = q as Record<string, unknown>
      const sid = row.supplier_id as string
      if (!lastMap.has(sid) && row.received_at) {
        lastMap.set(sid, row.received_at as string)
      }
    }

    const result = (suppliers ?? []).map((s: Record<string, unknown>) => ({
      ...s,
      active_quotes: activeMap.get(s.id as string) ?? 0,
      lowest_count: lowestMap.get(s.id as string) ?? 0,
      last_received: lastMap.get(s.id as string) ?? null,
      has_market_link: marketLinkSet.has(s.id as string),
      is_competitor: compNameMap.has(s.id as string),
      linked_competitor_name: compNameMap.get(s.id as string) ?? null,
    }))

    return NextResponse.json({ suppliers: result })
  } catch (err) {
    console.error('[pricing/suppliers]', err)
    return NextResponse.json({ error: 'Failed to fetch suppliers' }, { status: 500 })
  }
}

const COLORS = ['#7c3aed','#10b981','#f59e0b','#ef4444','#7c3aed','#3b82f6','#ec4899','#14b8a6','#f97316','#84cc16']

export async function POST(request: Request) {
  // RBAC(SEC HIGH 수정): 공급사 마스터 직접 등록은 admin 전용.
  //   통합입력 중 신규 공급사 자동 생성은 quotes 라우트가 서버측(source:'integrated')에서 수행하므로
  //   이 엔드포인트에서 source 분기를 두면 위조('integrated')로 권한 우회가 됨 → 분기 폐기, 항상 admin.
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const body = await request.json()
    const { name, location, contact, country, website, description, color: colorIn } = body
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

    const source = 'manual' // 이 엔드포인트로의 등록은 항상 수동 마스터 관리
    const color = (typeof colorIn === 'string' && colorIn.trim()) || COLORS[Math.floor(Math.random() * COLORS.length)]
    const websiteVal = website?.trim() || null
    const logo_url = logoFromWebsite(websiteVal)                    // 웹사이트 → 로고 자동 수집
    const { data, error } = await db
      .from('suppliers')
      .insert({
        name: name.trim(),
        location: location?.trim() || null,
        contact: contact?.trim() || null,
        country: country?.trim() || null,
        website: websiteVal,
        description: description?.trim() || null,
        color, logo_url, source,
      })
      .select()
      .single()

    if (error) throw error
    // accounts(is_supplier) 생성·링크 (회사=accounts 통합 — 담당자/딜 매핑 일관)
    const account_id = await ensureSupplierAccount(createAdminClient(), {
      id: data.id, name: data.name, country: data.country, website: data.website,
      description: data.description, color: data.color, logo_url: data.logo_url,
    }, auth.user.id)
    return NextResponse.json({ supplier: { ...data, account_id } })
  } catch (err) {
    console.error('[pricing/suppliers POST]', err)
    return NextResponse.json({ error: 'Failed to create supplier' }, { status: 500 })
  }
}
