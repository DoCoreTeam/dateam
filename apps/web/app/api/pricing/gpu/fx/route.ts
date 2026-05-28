import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const KOREAEXIM_BASE = 'https://www.koreaexim.go.kr/site/program/financial/exchangeJSON'

async function fetchKoraeximRate(authKey: string, date: string): Promise<number | null> {
  const url = `${KOREAEXIM_BASE}?authkey=${authKey}&searchdate=${date.replace(/-/g, '')}&data=AP01`
  const res = await fetch(url, { next: { revalidate: 0 } })
  if (!res.ok) return null
  const json = await res.json()
  if (!Array.isArray(json)) return null
  const usdRow = json.find((r: Record<string, string>) => r.cur_unit === 'USD')
  if (!usdRow) return null
  const rate = parseFloat(String(usdRow.deal_bas_r).replace(/,/g, ''))
  return isNaN(rate) ? null : rate
}

export async function POST() {
  try {
    const apiKey = process.env.KOREAEXIM_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'KOREAEXIM_API_KEY not configured' }, { status: 500 })
    }

    const today = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' })
    let rate = await fetchKoraeximRate(apiKey, today)

    // fallback: try previous business day if today has no data
    if (rate == null) {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const ydStr = yesterday.toLocaleDateString('sv', { timeZone: 'Asia/Seoul' })
      rate = await fetchKoraeximRate(apiKey, ydStr)
    }

    if (rate == null) {
      return NextResponse.json({ error: 'Could not fetch FX rate' }, { status: 502 })
    }

    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { error } = await db
      .from('fx_rates')
      .upsert({ rate_date: today, usd_krw: rate, source: 'koreaexim', fetched_at: new Date().toISOString() })

    if (error) throw error

    return NextResponse.json({ rate_date: today, usd_krw: rate })
  } catch (err) {
    console.error('[pricing/fx POST]', err)
    return NextResponse.json({ error: 'Failed to fetch/store FX rate' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data, error } = await db
      .from('fx_rates')
      .select('*')
      .order('rate_date', { ascending: false })
      .limit(7)

    if (error) throw error

    return NextResponse.json({ rates: data ?? [] })
  } catch (err) {
    console.error('[pricing/fx GET]', err)
    return NextResponse.json({ error: 'Failed to fetch FX rates' }, { status: 500 })
  }
}
