import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { saveCompetitorPrices, type CompetitorPriceItem } from '@/lib/gpu/competitor-import'
import { competitorPriceToUsd } from '@/lib/gpu/normalize-money'
import { safeFetchText } from '@/lib/security/safe-fetch'
import { kstTodayKey } from '@/lib/datetime/kst'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

const CLASSIFY_PROMPT = `당신은 GPU 클라우드 가격 분석 AI입니다. 입력된 내용을 분석하여 분류하세요.

분류 기준:
- competitor_pricing: RunPod, Lambda Labs, AWS, CoreWeave, Vast.ai, NHN Cloud, NAVER Cloud, Azure, GCP, Runyour AI, SaladCloud 등 경쟁 클라우드 서비스의 GPU 가격 정보
- supplier_quote: AX사업본부가 구매/공급받는 GPU 하드웨어/클라우드 자원 견적 (공급사로부터 받은 견적)

【중요 — 시간 단위 정규화 (price_usd는 반드시 "GPU 1장·1시간당 USD")】
가격이 시간당(/hr)이 아니면 반드시 환산: 월 ÷730 · 주 ÷168 · 일 ÷24 · 년 ÷8760. 여러 장 묶음은 장수로 나눠 1장당. notes에 원본 기재.
  예) $138.54/월 → price_usd: 0.19, notes: "원본: $138.54/월 (÷730)"

【중요 — 통화 규칙 (환율 환산 절대 금지)】
환율 계산은 절대 하지 마세요. 원본 통화와 원본 금액을 그대로 보고하면 서버가 환산합니다.
- original_currency: 원본 통화 ISO 코드("USD"|"KRW"|"JPY"|"EUR"|"CNY" 등). 통화 기호(₩/円/¥/€/元)나 표기로 판별. 판별 불가면 "USD".
- original_price: 원본 통화 기준 금액(GPU 1장·1시간당으로 시간 단위만 정규화). 예) ¥30,000/월 → original_currency:"JPY", original_price: 41.6 (=30000÷720). 절대 달러로 바꾸지 마세요.
- 시간 단위 정규화(월÷730 등)만 적용하고, 통화는 손대지 마세요.

competitor_pricing인 경우 JSON 반환:
{
  "type": "competitor",
  "items": [
    {
      "competitor_name": "회사명",
      "model_name": "H100",
      "memory": "80GB",
      "original_currency": "KRW",
      "original_price": 3615,
      "pricing_model": "on-demand",
      "notes": "원본: 3,615 KRW/hr"
    }
  ]
}

pricing_model 값: "on-demand" | "reserved-1y" | "reserved-3y" | "spot"
memory 값: "80GB", "40GB", "24GB" 등 숫자+단위
notes 필드: 원본 표기(통화·기간)를 그대로 기재

supplier_quote이거나 GPU 가격이 아닌 경우:
{ "type": "supplier" }

JSON만 반환. 설명 없이.`

async function fetchUrlText(url: string): Promise<string> {
  try {
    // SSRF 방어: safe-fetch SSOT (스킴·사설망·리다이렉트·크기 검증)
    const res = await safeFetchText(url, {
      timeoutMs: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    if (!res.ok) return ''
    const html = res.text
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 15000)
  } catch {
    return ''
  }
}

// saveCompetitorPrices는 lib/gpu/competitor-import.ts SSOT 사용(복사본 제거 — resolveProductId로 깡통 생성 차단).

// POST /api/pricing/gpu/market/refresh
// DB에 저장된 URL들을 AI로 분석해서 market_prices 업데이트
export async function POST(req: Request) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  // 자동 수집 모드(?auto=1) — 그날 첫 접속자가 1회만 구동. run_date(KST) 멱등키로 하루 1회·경합방지. (헌법 제10조)
  const isAuto = new URL(req.url).searchParams.get('auto') === '1'
  const runDate = kstTodayKey()  // KST 기준 '오늘'

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient as any

  if (isAuto) {
    // 오늘 실행 기록을 선점(INSERT). 기본키 충돌=이미 누군가 오늘 돌림 → 조용히 스킵.
    const { error: claimErr } = await db.from('market_refresh_runs')
      .insert({ run_date: runDate, status: 'running', trigger_source: 'first-visit' })
    if (claimErr) {
      // 23505=unique_violation → 이미 오늘 돌았음(정상 스킵). 그 외(DB 장애 등)는 원인을 서버 로그로 남긴다(가시성).
      if (claimErr.code && claimErr.code !== '23505') console.error('[gpu/market/refresh] auto claim 실패:', claimErr)
      return NextResponse.json({ skipped: true, reason: claimErr.code === '23505' ? 'already_ran_today' : 'claim_failed', run_date: runDate })
    }
  }

  // Gemini 설정
  const { data: metaRow } = await db.from('org_content').select('value').eq('key', 'META').single()
  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash'

  if (!apiKey) {
    if (isAuto) await db.from('market_refresh_runs').update({ status: 'error', finished_at: new Date().toISOString(), error: 'AI 키가 설정되지 않았습니다' }).eq('run_date', runDate)
    return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다' }, { status: 500 })
  }

  // 활성 매핑 + 경쟁사 URL 조회
  const { data: mappings, error: mapErr } = await db
    .from('competitor_product_mapping')
    .select(`
      id, competitor_url,
      competitors!competitor_id(id, name, pricing_url)
    `)
    .eq('is_active', true)

  if (mapErr) {
    if (isAuto) await db.from('market_refresh_runs').update({ status: 'error', finished_at: new Date().toISOString(), error: '매핑 조회 실패' }).eq('run_date', runDate)
    return NextResponse.json({ error: mapErr.message }, { status: 500 })
  }

  // URL 수집: competitor_url 우선, 없으면 pricing_url
  const urlSet = new Map<string, string>() // url → competitor name
  for (const m of (mappings ?? [])) {
    const compUrl = m.competitor_url as string | null
    const pricingUrl = m.competitors?.pricing_url as string | null
    const compName = m.competitors?.name as string ?? 'unknown'
    const url = compUrl || pricingUrl
    if (url && !urlSet.has(url)) {
      urlSet.set(url, compName)
    }
  }

  if (urlSet.size === 0) {
    if (isAuto) await db.from('market_refresh_runs').update({ status: 'done', finished_at: new Date().toISOString(), urls_checked: 0, prices_updated: 0 }).eq('run_date', runDate)
    return NextResponse.json({
      message: '분석할 URL이 없습니다. 경쟁사에 pricing_url을 등록하거나 매핑에 competitor_url을 추가하세요.',
      urls_checked: 0,
      prices_updated: 0,
    })
  }

  const results: { url: string; competitor: string; prices_found: number; held?: number; rejected?: number; currency_held?: number; error?: string }[] = []
  let totalPricesUpdated = 0

  // 통화 환산은 코드(SSOT)가 한다 — AI는 원본 통화/금액만 보고. fx_rates 실환율 주입(하드코딩 금지). 폴백 1400.
  //   USD=그대로, KRW=fx 환산, 그 외(JPY/EUR/CNY)=null 보류(USD 둔갑 금지). competitorPriceToUsd SSOT.
  const { data: fxRow } = await db.from('fx_rates').select('usd_krw').order('rate_date', { ascending: false }).limit(1).maybeSingle()
  const krwPerUsd = typeof fxRow?.usd_krw === 'number' && fxRow.usd_krw > 0 ? fxRow.usd_krw : 1400

  for (const [url, compName] of Array.from(urlSet.entries())) {
    try {
      const pageText = await fetchUrlText(url)
      if (!pageText) {
        results.push({ url, competitor: compName, prices_found: 0, error: '페이지 로드 실패' })
        continue
      }

      const classifyRes = await fetch(
        `${GEMINI_API_BASE}/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${CLASSIFY_PROMPT}\n\n입력:\n${pageText}` }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0 },
          }),
        }
      )

      if (!classifyRes.ok) {
        results.push({ url, competitor: compName, prices_found: 0, error: `AI 오류 (${classifyRes.status})` })
        continue
      }

      const classifyJson = await classifyRes.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      const rawText = classifyJson.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

      let classified: { type: string; items?: CompetitorPriceItem[] }
      try { classified = JSON.parse(rawText) } catch {
        results.push({ url, competitor: compName, prices_found: 0, error: 'AI 응답 파싱 실패' })
        continue
      }

      if (classified.type === 'competitor' && Array.isArray(classified.items) && classified.items.length > 0) {
        // 통화 정규화(SSOT) — AI가 준 원본 통화/금액을 코드가 USD로 환산(비지원 통화는 null 보류). AI 자체환산 폐기.
        const normalized: CompetitorPriceItem[] = (classified.items as CompetitorPriceItem[]).map((it) => ({
          ...it,
          original_currency: it.original_currency ?? null,
          original_price: typeof it.original_price === 'number' ? it.original_price : null,
          price_usd: competitorPriceToUsd(it.original_currency, it.original_price, krwPerUsd),
        }))
        // 무음 소실 금지 — 비지원 통화(JPY/EUR/CNY)로 보류(price_usd=null)된 건수를 별도 집계해 노출.
        //   (saveCompetitorPrices의 truthy 스킵보다 앞서 여기서 세어야 관리자가 "환율 미지원으로 보류"를 인지)
        const currencyHeld = normalized.filter((n) => n.price_usd == null && !!n.original_currency && n.original_currency !== 'USD').length
        // H1 게이트(validateCompetitorItem)는 saveCompetitorPrices 내부에서 강제 — 자동 크롤 경로도 GPU 아님·이상가 차단.
        const { saved, held, rejected } = await saveCompetitorPrices(db, normalized, { sourceUrl: url, confidence: 80 })
        results.push({ url, competitor: compName, prices_found: saved.length, ...(held.length ? { held: held.length } : {}), ...(rejected.length ? { rejected: rejected.length } : {}), ...(currencyHeld ? { currency_held: currencyHeld } : {}) })
        totalPricesUpdated += saved.length
      } else {
        results.push({ url, competitor: compName, prices_found: 0 })
      }
    } catch (err) {
      console.error('[gpu/market/refresh] url fetch/parse 실패:', url, err)  // 상세는 서버 로그만
      results.push({ url, competitor: compName, prices_found: 0, error: err instanceof Error ? err.message : '수집 실패' })
    }
  }

  if (isAuto) await db.from('market_refresh_runs').update({ status: 'done', finished_at: new Date().toISOString(), urls_checked: urlSet.size, prices_updated: totalPricesUpdated }).eq('run_date', runDate)

  return NextResponse.json({
    urls_checked: urlSet.size,
    prices_updated: totalPricesUpdated,
    results,
  })
}
