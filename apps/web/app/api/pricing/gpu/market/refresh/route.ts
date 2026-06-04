import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { normalizeMemory } from '@/lib/gpu/normalize'

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
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    if (!res.ok) return ''
    const html = await res.text()
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
  } finally {
    clearTimeout(timer)
  }
}

interface CompetitorPriceItem {
  competitor_name: string
  model_name: string
  memory: string
  price_usd: number
  pricing_model: string
  notes?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function saveCompetitorPrices(db: any, items: CompetitorPriceItem[], sourceUrl: string): Promise<number> {
  let count = 0
  const now = new Date().toISOString()

  for (const item of items) {
    if (!item.competitor_name || !item.model_name || !item.price_usd) continue

    let competitorId: string
    const { data: existingComp } = await db
      .from('competitors').select('id').ilike('name', item.competitor_name.trim()).single()

    if (existingComp?.id) {
      competitorId = existingComp.id
    } else {
      const compName = item.competitor_name.trim()
      const { data: newComp, error: compErr } = await db
        .from('competitors')
        .insert({ name: compName, short_name: compName.slice(0, 20), type: 'specialist' })
        .select('id').single()
      if (compErr || !newComp) continue
      competitorId = newComp.id
    }

    let gpuProductId: string
    const memory = normalizeMemory(item.memory ?? '')
    const { data: existingGpu } = await db
      .from('gpu_products').select('id').ilike('model_name', item.model_name.trim()).eq('memory', memory).single()

    if (existingGpu?.id) {
      gpuProductId = existingGpu.id
    } else {
      const { data: newGpu, error: gpuErr } = await db
        .from('gpu_products')
        .insert({ model_name: item.model_name.trim(), memory, tier: 1, pricing_mode: 'quote', gpu_count: 1, vcpu: 12, ram_gb: 16, storage_gb: 512 })
        .select('id').single()
      if (gpuErr || !newGpu) continue
      gpuProductId = newGpu.id
    }

    let mappingId: string
    const pricingModel = (item.pricing_model ?? 'on_demand').replace(/-/g, '_')
    const { data: existingMap } = await db
      .from('competitor_product_mapping').select('id')
      .eq('competitor_id', competitorId).eq('gpu_product_id', gpuProductId).eq('pricing_model', pricingModel).single()

    if (existingMap?.id) {
      mappingId = existingMap.id
      // URL을 mapping에 저장 (기존 매핑에 URL 업데이트)
      await db.from('competitor_product_mapping').update({ competitor_url: sourceUrl }).eq('id', mappingId)
    } else {
      const sku = `${item.model_name} ${memory} (${pricingModel})`.trim()
      const { data: newMap, error: mapErr } = await db
        .from('competitor_product_mapping')
        .insert({ competitor_id: competitorId, gpu_product_id: gpuProductId, competitor_sku: sku, pricing_model: pricingModel, competitor_url: sourceUrl, is_active: true })
        .select('id').single()
      if (mapErr || !newMap) continue
      mappingId = newMap.id
    }

    await db.from('market_prices').insert({
      mapping_id: mappingId,
      price_usd: item.price_usd,
      source_url: sourceUrl,
      source_type: 'webpage',
      recorded_at: now,
      observed_at: now,
      confidence: 80,
      is_stale: false,
      ...(item.notes ? { notes: item.notes } : {}),
    })
    count++
  }

  return count
}

// POST /api/pricing/gpu/market/refresh
// DB에 저장된 URL들을 AI로 분석해서 market_prices 업데이트
export async function POST() {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient as any

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
    return NextResponse.json({
      message: '분석할 URL이 없습니다. 경쟁사에 pricing_url을 등록하거나 매핑에 competitor_url을 추가하세요.',
      urls_checked: 0,
      prices_updated: 0,
    })
  }

  const results: { url: string; competitor: string; prices_found: number; error?: string }[] = []
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
        const saved = await saveCompetitorPrices(db, classified.items, url)
        results.push({ url, competitor: compName, prices_found: saved })
        totalPricesUpdated += saved
      } else {
        results.push({ url, competitor: compName, prices_found: 0 })
      }
    } catch (err) {
      results.push({ url, competitor: compName, prices_found: 0, error: String(err) })
    }
  }

  return NextResponse.json({
    urls_checked: urlSet.size,
    prices_updated: totalPricesUpdated,
    results,
  })
}
