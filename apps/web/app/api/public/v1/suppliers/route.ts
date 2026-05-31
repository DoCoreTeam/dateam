import { NextRequest, NextResponse } from 'next/server'
import { authenticatePublicApi, corsHeaders, optionsResponse } from '@/lib/publicApiAuth'
import { createAdminClient } from '@/lib/supabase/server'

export async function OPTIONS() {
  return optionsResponse()
}

export async function GET(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any

    const { data: suppliers, error } = await admin
      .from('suppliers')
      .select('id, name, location, color, contact, created_at')
      .order('name')

    if (error) throw error

    const supplierIds = (suppliers ?? []).map((s: Record<string, unknown>) => s.id as string)

    const [activeRes, lowestRes, lastRes] = await Promise.all([
      supplierIds.length > 0
        ? admin.from('supply_quotes').select('supplier_id').in('supplier_id', supplierIds).eq('status', 'confirmed')
        : Promise.resolve({ data: [] }),
      supplierIds.length > 0
        ? admin.from('v_lowest_quotes').select('supplier_id').in('supplier_id', supplierIds)
        : Promise.resolve({ data: [] }),
      supplierIds.length > 0
        ? admin.from('supply_quotes').select('supplier_id, received_at').in('supplier_id', supplierIds).order('received_at', { ascending: false })
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

    const lastMap = new Map<string, string>()
    for (const q of lastRes.data ?? []) {
      const row = q as Record<string, unknown>
      const sid = row.supplier_id as string
      if (!lastMap.has(sid) && row.received_at) lastMap.set(sid, row.received_at as string)
    }

    const result = (suppliers ?? []).map((s: Record<string, unknown>) => ({
      ...s,
      active_quotes: activeMap.get(s.id as string) ?? 0,
      lowest_count: lowestMap.get(s.id as string) ?? 0,
      last_received: lastMap.get(s.id as string) ?? null,
    }))

    return NextResponse.json(
      { success: true, data: result, meta: { total: result.length } },
      { headers: corsHeaders() }
    )
  } catch (err) {
    console.error('[public/v1/suppliers GET]', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: corsHeaders() }
    )
  }
}

const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#3b82f6','#ec4899','#14b8a6','#f97316','#84cc16']

export async function POST(request: NextRequest) {
  const auth = await authenticatePublicApi(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const { name, location, contact } = body
    if (!name?.trim()) {
      return NextResponse.json(
        { success: false, error: 'name is required' },
        { status: 400, headers: corsHeaders() }
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const color = COLORS[Math.floor(Math.random() * COLORS.length)]
    const { data, error } = await admin
      .from('suppliers')
      .insert({ name: name.trim(), location: location?.trim() || null, contact: contact?.trim() || null, color })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(
      { success: true, data },
      { status: 201, headers: corsHeaders() }
    )
  } catch (err) {
    console.error('[public/v1/suppliers POST]', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: corsHeaders() }
    )
  }
}
