import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'

const KOREAEXIM_BASE = 'https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON'

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

// 최대 fallback 일수 — 주말+공휴일 대비 3일치
const MAX_FALLBACK_DAYS = 3

export async function POST() {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  try {
    const adminForKey = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: metaRow } = await (adminForKey as any)
      .from('org_content')
      .select('value')
      .eq('key', 'META')
      .single()
    const meta = (metaRow?.value as Record<string, unknown>) ?? {}
    const apiKey = typeof meta.koreaexim_api_key === 'string' ? meta.koreaexim_api_key : ''
    if (!apiKey) {
      return NextResponse.json({ error: '환율 API 키가 설정되지 않았습니다 (관리자 설정에서 등록)' }, { status: 500 })
    }

    let rate: number | null = null
    let usedDate = ''

    for (let i = 0; i <= MAX_FALLBACK_DAYS; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toLocaleDateString('sv', { timeZone: 'Asia/Seoul' })
      rate = await fetchKoraeximRate(apiKey, dateStr)
      if (rate != null) {
        usedDate = dateStr
        break
      }
    }

    if (rate == null) {
      return NextResponse.json({ error: 'Could not fetch FX rate' }, { status: 502 })
    }

    // service role 클라이언트로 RLS 우회하여 저장
    // @supabase/supabase-js(admin)와 @supabase/ssr(createClient) 제네릭 불일치로
    // .from().upsert() 타입 추론이 never[]로 붕괴하는 라이브러리 버그 — as any 불가피
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { error } = await admin
      .from('fx_rates')
      .upsert({ rate_date: usedDate, usd_krw: rate, source: 'koreaexim' })

    if (error) throw error

    // 환율 변경은 sell_price_krw 전체에 영향 → 4탭 캐시 무효화 (stale 방지)
    revalidateGpu()

    return NextResponse.json({ rate_date: usedDate, usd_krw: rate })
  } catch (err) {
    console.error('[pricing/fx POST]', err)
    return NextResponse.json({ error: 'Failed to fetch/store FX rate' }, { status: 500 })
  }
}

export async function GET() {
  try {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
    const supabase = await createClient()
    const { data, error } = await supabase
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
