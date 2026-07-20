import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { parseKoraeximRows, type FxRateNormalized } from '@/lib/gpu/fx-parse'

const KOREAEXIM_BASE = 'https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON'

// AP01 전통화 응답을 한 번에 받아 정규화(JPY 100단위·콤마 처리는 fx-parse SSOT). USD가 없으면 null(그 날짜 미고시).
async function fetchKoraeximAll(authKey: string, date: string): Promise<FxRateNormalized[] | null> {
  const url = `${KOREAEXIM_BASE}?authkey=${authKey}&searchdate=${date.replace(/-/g, '')}&data=AP01`
  const res = await fetch(url, { next: { revalidate: 0 } })
  if (!res.ok) return null
  const json = await res.json()
  const parsed = parseKoraeximRows(json)
  // USD가 있어야 유효 고시일로 간주(휴일·미고시일은 빈 배열로 옴).
  return parsed.some((p) => p.currency === 'USD') ? parsed : null
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

    let all: FxRateNormalized[] | null = null
    let usedDate = ''

    // 휴일·미고시일 → 직전 영업일 폴백. 실제 적용된 날짜(usedDate)를 저장(요청일 아님).
    for (let i = 0; i <= MAX_FALLBACK_DAYS; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toLocaleDateString('sv', { timeZone: 'Asia/Seoul' })
      all = await fetchKoraeximAll(apiKey, dateStr)
      if (all != null) { usedDate = dateStr; break }
    }

    if (all == null) {
      return NextResponse.json({ error: 'Could not fetch FX rate' }, { status: 502 })
    }
    const usdRate = all.find((r) => r.currency === 'USD')!.krw_per_1

    // service role 클라이언트로 RLS 우회하여 저장
    // @supabase/supabase-js(admin)와 @supabase/ssr(createClient) 제네릭 불일치로
    // .from().upsert() 타입 추론이 never[]로 붕괴하는 라이브러리 버그 — as any 불가피
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    // (1) 기존 usd_krw 표(호환 유지)
    const { error } = await admin
      .from('fx_rates')
      .upsert({ rate_date: usedDate, usd_krw: usdRate, source: 'koreaexim' })
    if (error) throw error
    // (2) 통화별 표(다통화 환산 기반) — 전통화 upsert. JPY 100단위는 krw_per_1로 정규화 완료.
    const multiRows = all.map((r) => ({
      rate_date: usedDate, currency: r.currency, per_unit: r.per_unit,
      deal_bas_krw: r.deal_bas_krw, krw_per_1: r.krw_per_1, source: 'koreaexim',
    }))
    const { error: multiErr } = await admin
      .from('fx_rates_multi')
      .upsert(multiRows, { onConflict: 'rate_date,currency' })
    if (multiErr) console.error('[pricing/fx] fx_rates_multi upsert 실패(무손실 로그):', multiErr.message)

    // 환율 변경은 sell_price_krw 전체에 영향 → 4탭 캐시 무효화 (stale 방지)
    revalidateGpu()

    return NextResponse.json({ rate_date: usedDate, usd_krw: usdRate, currencies: all.length })
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
