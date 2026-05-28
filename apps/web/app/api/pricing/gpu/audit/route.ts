import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data, error } = await db
      .from('gpu_audit_logs')
      .select('*, gpu_products(model_name, memory, tier)')
      .order('ts', { ascending: false })
      .limit(100)

    if (error) throw error

    return NextResponse.json({ logs: data ?? [] })
  } catch (err) {
    console.error('[pricing/audit]', err)
    return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 })
  }
}
