import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { saveCompetitorPrices, type CompetitorPriceItem } from '@/lib/gpu/competitor-import'
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

【중요 — 통화 변환 규칙】
가격이 달러($, USD)가 아닌 다른 단위인 경우 반드시 USD로 변환하세요:
- KRW / 원 / ₩ / P(포인트) / C(크레딧): 1 USD = 1370 KRW 기준으로 나누어 USD 환산. notes 필드에 원본 가격 기재
- JPY / 円: 1 USD = 155 JPY 기준
- EUR / €: 1 EUR = 1.09 USD 기준
- 그 외 통화: 최신 환율 추정 적용, notes에 원본 기재
- 통화·시간 변환이 모두 필요하면 둘 다 적용.

competitor_pricing인 경우 JSON 반환:
{
  "type": "competitor",
  "items": [
    {
      "competitor_name": "회사명",
      "model_name": "H100",
      "memory": "80GB",
      "price_usd": 2.39,
      "pricing_model": "on-demand",
      "notes": "원본: 3,615 KRW/hr (1USD=1370KRW 환산)"
    }
  ]
}

pricing_model 값: "on-demand" | "reserved-1y" | "reserved-3y" | "spot"
memory 값: "80GB", "40GB", "24GB" 등 숫자+단위
notes 필드: 통화 변환이 있을 때만 기재, USD 직접 가격이면 생략 가능

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
      // 23505=unique_violation → 이미 오늘 돌았음(정상 스킵). 그 외 에러는 로깅만 하고 스킵(자동은 조용히).
      return NextResponse.json({ skipped: true, reason: 'already_ran_today', run_date: runDate })
    }
  }

  // Gemini 설정
  const { data: metaRow } = await db.from('org_content').select('value').eq('key', 'META').single()
  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash'

  if (!apiKey) return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다' }, { status: 500 })

  // 활성 매핑 + 경쟁사 URL 조회
  const { data: mappings, error: mapErr } = await db
    .from('competitor_product_mapping')
    .select(`
      id, competitor_url,
      competitors!competitor_id(id, name, pricing_url)
    `)
    .eq('is_active', true)

  if (mapErr) return NextResponse.json({ error: mapErr.message }, { status: 500 })

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

  const results: { url: string; competitor: string; prices_found: number; held?: number; error?: string }[] = []
  let totalPricesUpdated = 0

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
        const { saved, held } = await saveCompetitorPrices(db, classified.items, { sourceUrl: url, confidence: 80 })
        results.push({ url, competitor: compName, prices_found: saved.length, ...(held.length ? { held: held.length } : {}) })
        totalPricesUpdated += saved.length
      } else {
        results.push({ url, competitor: compName, prices_found: 0 })
      }
    } catch (err) {
      results.push({ url, competitor: compName, prices_found: 0, error: String(err) })
    }
  }

  if (isAuto) await db.from('market_refresh_runs').update({ status: 'done', finished_at: new Date().toISOString(), urls_checked: urlSet.size, prices_updated: totalPricesUpdated }).eq('run_date', runDate)

  return NextResponse.json({
    urls_checked: urlSet.size,
    prices_updated: totalPricesUpdated,
    results,
  })
}
