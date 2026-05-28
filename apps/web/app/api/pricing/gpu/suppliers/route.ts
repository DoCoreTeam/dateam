import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data: suppliers, error } = await db
      .from('suppliers')
      .select('id, name, location, color, contact, created_at')
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
