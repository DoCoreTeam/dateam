import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data: suppliers, error } = await db
      .from('suppliers')
      .select('id, name, location, color, contact, country, website, description, logo_url, created_at')
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
    }))

    return NextResponse.json({ suppliers: result })
  } catch (err) {
    console.error('[pricing/suppliers]', err)
    return NextResponse.json({ error: 'Failed to fetch suppliers' }, { status: 500 })
  }
}

const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#3b82f6','#ec4899','#14b8a6','#f97316','#84cc16']

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const body = await request.json()
    const { name, location, contact, country, website, description, color: colorIn } = body
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

    const color = (typeof colorIn === 'string' && colorIn.trim()) || COLORS[Math.floor(Math.random() * COLORS.length)]
    const { data, error } = await db
      .from('suppliers')
      .insert({
        name: name.trim(),
        location: location?.trim() || null,
        contact: contact?.trim() || null,
        country: country?.trim() || null,
        website: website?.trim() || null,
        description: description?.trim() || null,
        color,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ supplier: data })
  } catch (err) {
    console.error('[pricing/suppliers POST]', err)
    return NextResponse.json({ error: 'Failed to create supplier' }, { status: 500 })
  }
}
