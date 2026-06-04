import GpuPricingClient from './GpuPricingClient'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'GPU 관리 | AX사업본부',
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

export default async function GpuPricingPage() {
  const initialSettings = await fetchInitialSettings()
  return <GpuPricingClient initialSettings={initialSettings} />
}
