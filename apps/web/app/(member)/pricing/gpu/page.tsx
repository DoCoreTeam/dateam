import GpuPricingClient from './GpuPricingClient'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getBranding } from '@/lib/branding'

export async function generateMetadata() {
  const { brandName } = await getBranding()
  return { title: `GPU 관리 | ${brandName}` }
}

export interface InitialSettings {
  margin_pct: number | null
  usd_krw: number | null
  fx_date: string | null
}

// 설정값(마진·환율)을 서버에서 미리 조회 → 첫 페인트부터 실제값 표시(하드코딩 깜빡임 제거)
async function fetchInitialSettings(): Promise<InitialSettings> {
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const [settingsRes, fxRes] = await Promise.all([
      db.from('pricing_settings').select('margin_pct').eq('id', 1).single(),
      db.from('fx_rates').select('usd_krw, rate_date').order('rate_date', { ascending: false }).limit(1).single(),
    ])
    return {
      margin_pct: settingsRes.data?.margin_pct ?? null,
      usd_krw: fxRes.data?.usd_krw ?? null,
      fx_date: fxRes.data?.rate_date ?? null,
    }
  } catch {
    return { margin_pct: null, usd_krw: null, fx_date: null }
  }
}

async function fetchIsAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const adminClient = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (adminClient as any)
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    return data?.role === 'admin'
  } catch {
    return false
  }
}

export default async function GpuPricingPage() {
  const [initialSettings, isAdmin] = await Promise.all([
    fetchInitialSettings(),
    fetchIsAdmin(),
  ])
  return <GpuPricingClient initialSettings={initialSettings} isAdmin={isAdmin} />
}
