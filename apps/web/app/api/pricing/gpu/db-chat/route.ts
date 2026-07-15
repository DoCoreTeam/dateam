import { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

async function getGeminiConfig(adminClient: ReturnType<typeof createAdminClient>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient as any)
    .from('org_content')
    .select('value')
    .eq('key', 'META')
    .single()
  const meta = (data?.value as Record<string, unknown>) ?? {}
  return {
    apiKey: typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : '',
    model: typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash',
  }
}

async function getPrompt(adminClient: ReturnType<typeof createAdminClient>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient as any)
    .from('ai_prompts')
    .select('content, version, model_hint')
    .eq('prompt_key', 'gpu.db-chat')
    .eq('active', true)
    .single()
  return data as { content: string; version: string; model_hint: string } | null
}

async function buildDbSnapshot(supabase: Awaited<ReturnType<typeof createClient>>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [products, quotes, auditLogs, suppliers, fxRates, settings, reviewItems, marketPrices, competitors, specs, directPrices] =
    await Promise.all([
      // 상품(카탈로그) — 등급·판매가·스펙까지 전부. AI가 우리 판매가/사양을 답하려면 필요.
      sb.from('gpu_products')
        .select('id,model_name,memory,tier,tier_locked,gpu_count,vcpu,ram_gb,storage_gb,strategic_price_krw,pricing_mode')
        .order('tier').limit(200),
      // 공급가(우리 매입가) — 원본통화·장수·가격유형·지정여부까지.
      sb.from('supply_quotes')
        .select('id,product_id,supplier_id,unit_price_usd,original_price,original_currency,gpu_count,price_type,is_selected,term,term_months,valid_until,status,received_at,registered_by,confirmed_by,confirmed_at')
        .gte('received_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
        .order('received_at', { ascending: false })
        .limit(150),
      sb.from('gpu_audit_logs')
        .select('ts,actor,action_type,detail,product_id')
        .gte('ts', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('ts', { ascending: false })
        .limit(150),
      sb.from('suppliers').select('id,name,country,tier'),
      sb.from('fx_rates').select('usd_krw,rate_date').order('rate_date', { ascending: false }).limit(1),
      sb.from('pricing_settings').select('margin_pct').limit(1),
      sb.from('review_items')
        .select('id,product_hint,supplier_hint,status,overall_confidence,confirmed_at,created_at')
        .is('deleted_at', null)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(50),
      // 경쟁사 시장가(남의 판매가) — 매핑(경쟁사×모델) 경유로 경쟁사명·모델명까지 함께. AI가 "누가 더 싼가"를 답하려면 필수.
      sb.from('market_prices')
        .select('price_usd,original_price,original_currency,observed_at,is_stale,competitor_product_mapping!mapping_id(competitors!competitor_id(name),gpu_products!gpu_product_id(model_name,memory))')
        .order('observed_at', { ascending: false })
        .limit(300),
      // 경쟁사 엔티티(회사 자체) — 이름·별칭·국가·가격페이지. "어느 경쟁사" 질문에 필요.
      sb.from('competitors').select('id,name,aliases,country,pricing_url').is('deleted_at', null).limit(100),
      // 모델 스펙 — 사양 질문 대응.
      sb.from('gpu_specs').select('*').limit(100),
      // 우리 직판/직접 재고 가격 — 우리가 직접 매기는 가격.
      sb.from('direct_prices').select('*').eq('is_current', true).limit(100),
    ])

  const supplierMap: Record<string, string> = {}
  for (const s of suppliers.data ?? []) supplierMap[s.id] = s.name

  const enrichedQuotes = (quotes.data ?? []).map((q: Record<string, unknown>) => ({
    ...q,
    supplier_name: typeof q.supplier_id === 'string' ? (supplierMap[q.supplier_id] ?? null) : null,
  }))

  // 경쟁사 시장가를 사람이 읽기 쉬운 평평한 형태로(경쟁사명·모델·가격·수집일).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flatMarket = (marketPrices.data ?? []).map((m: any) => ({
    competitor: m.competitor_product_mapping?.competitors?.name ?? null,
    model: m.competitor_product_mapping?.gpu_products?.model_name ?? null,
    memory: m.competitor_product_mapping?.gpu_products?.memory ?? null,
    price_usd: m.price_usd ?? null,
    original_price: m.original_price ?? null,
    original_currency: m.original_currency ?? null,
    observed_at: m.observed_at ?? null,
    is_stale: m.is_stale ?? false,
  }))

  return {
    gpu_products: products.data ?? [],           // 우리 카탈로그(등급·판매가·사양)
    supply_quotes: enrichedQuotes,               // 공급가(우리 매입가)
    competitor_market_prices: flatMarket,        // 경쟁사 시장가(남의 판매가)
    competitors: competitors.data ?? [],         // 경쟁사 회사 목록(이름·별칭·국가)
    gpu_specs: specs.data ?? [],                 // 모델 스펙
    direct_prices: directPrices.data ?? [],      // 우리 직판/직접 가격
    gpu_audit_logs: auditLogs.data ?? [],        // 변동 이력
    suppliers: suppliers.data ?? [],             // 공급사
    fx_rates: fxRates.data?.[0] ?? null,         // 환율
    pricing_settings: settings.data?.[0] ?? null,
    review_items: reviewItems.data ?? [],        // 검토 대기
    snapshot_time: new Date().toISOString(),
  }
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatResponse {
  answer: string
  data: Record<string, unknown>[]
  source_tables: string[]
  found: boolean
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const supabase = await createClient()
  const user = auth.user

  let body: { query?: unknown; history?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (!query) return NextResponse.json({ error: '질문을 입력해주세요' }, { status: 400 })
  if (query.length > 300) return NextResponse.json({ error: '질문이 너무 깁니다 (300자 이하)' }, { status: 400 })

  const history: ChatMessage[] = Array.isArray(body.history)
    ? (body.history as ChatMessage[]).slice(-5)
    : []

  const adminClient = createAdminClient()
  const [config, prompt, snapshot] = await Promise.all([
    getGeminiConfig(adminClient),
    getPrompt(adminClient),
    buildDbSnapshot(supabase),
  ])

  if (!config.apiKey) return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다' }, { status: 500 })
  if (!prompt) return NextResponse.json({ error: 'AI 프롬프트가 설정되지 않았습니다' }, { status: 500 })

  const systemPrompt = prompt.content.replace('{{DB_SNAPSHOT}}', JSON.stringify(snapshot, null, 2))

  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = []
  for (const msg of history) {
    contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] })
  }
  contents.push({ role: 'user', parts: [{ text: query }] })

  const url = `${GEMINI_API_BASE}/models/${config.model}:streamGenerateContent?alt=sse`
  let geminiRes: Response
  try {
    geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
    })
  } catch {
    return NextResponse.json({ error: 'AI 서버 연결 실패' }, { status: 502 })
  }

  if (!geminiRes.ok || !geminiRes.body) {
    return NextResponse.json({ error: `AI API 오류 (${geminiRes.status})` }, { status: 502 })
  }

  const encoder = new TextEncoder()
  let fullText = ''
  let lastAnswerLen = 0
  let usageMeta: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } = {}

  const stream = new ReadableStream({
    async start(controller) {
      const reader = geminiRes.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const jsonStr = line.slice(6).trim()
            if (!jsonStr) continue

            try {
              const gc = JSON.parse(jsonStr) as {
                candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
                usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
              }
              if (gc.usageMetadata) usageMeta = gc.usageMetadata
              const text = gc.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
              fullText += text

              // answer 필드 텍스트 점진 추출
              const markerIdx = fullText.indexOf('"answer":')
              if (markerIdx !== -1) {
                let qi = markerIdx + 9
                while (qi < fullText.length && fullText[qi] !== '"') qi++
                if (qi < fullText.length) {
                  let raw = ''
                  let i = qi + 1
                  while (i < fullText.length) {
                    if (fullText[i] === '\\' && i + 1 < fullText.length) {
                      const nx = fullText[i + 1]
                      if (nx === 'n') raw += '\n'
                      else if (nx === '"') raw += '"'
                      else if (nx === '\\') raw += '\\'
                      else raw += nx
                      i += 2
                    } else if (fullText[i] === '"') {
                      break
                    } else {
                      raw += fullText[i++]
                    }
                  }
                  if (raw.length > lastAnswerLen) {
                    const chunk = raw.slice(lastAnswerLen)
                    lastAnswerLen = raw.length
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`))
                  }
                }
              }
            } catch { /* skip malformed chunk */ }
          }
        }
      } catch (err) {
        console.error('[db-chat] stream error:', err)
      }

      // 최종 JSON 파싱 → done 이벤트
      try {
        const parsed: ChatResponse = JSON.parse(fullText)
        logTokenUsage({
          userId: user.id,
          feature: 'gpu-db-chat',
          model: config.model,
          promptTokens: usageMeta.promptTokenCount ?? 0,
          outputTokens: usageMeta.candidatesTokenCount ?? 0,
          totalTokens: usageMeta.totalTokenCount ?? 0,
        })
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          done: true,
          answer: typeof parsed.answer === 'string' ? parsed.answer : '',
          data: Array.isArray(parsed.data) ? parsed.data : [],
          source_tables: Array.isArray(parsed.source_tables) ? parsed.source_tables : [],
          found: parsed.found === true,
        })}\n\n`))
      } catch {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, error: 'AI 응답 파싱 실패' })}\n\n`))
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
