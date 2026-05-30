import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

interface ReviewItem {
  id: string
  source_input_id: string | null
  source_batch_id: string | null
  batch_index: number
  product_hint: string | null
  supplier_hint: string | null
  channel: string | null
  impact_level: string | null
  status: string
  current_iteration: number
  current_extracted: Record<string, unknown> | null
  current_confidence: Record<string, unknown> | null
  overall_confidence: number | null
  confirmed_by: string | null
  confirmed_at: string | null
  confirmed_items: unknown[] | null
  rejected_reason: string | null
  is_test: boolean
  created_at: string
  updated_at: string
}

interface CompetitorPriceItem {
  competitor_name: string
  model_name: string
  memory: string
  price_usd: number
  pricing_model: string
}

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
    .eq('prompt_key', 'gpu.quote-extract')
    .eq('active', true)
    .single()
  return data as { content: string; version: string; model_hint: string } | null
}

async function callGemini(
  apiKey: string,
  model: string,
  parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }>,
  jsonMode = true,
) {
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: jsonMode ? { responseMimeType: 'application/json', temperature: 0 } : { temperature: 0 },
    }),
  })
  return res
}

// URL에서 텍스트 추출 (HTML 파싱)
async function fetchUrlText(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
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
    // 간단한 HTML 태그 제거
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

const CLASSIFY_PROMPT = `당신은 GPU 클라우드 가격 분석 AI입니다. 입력된 내용을 분석하여 분류하세요.

분류 기준:
- competitor_pricing: RunPod, Lambda Labs, AWS, CoreWeave, Vast.ai, NHN Cloud, NAVER Cloud, Azure, GCP 등 경쟁 클라우드 서비스의 GPU 가격 정보
- supplier_quote: AX사업본부가 구매/공급받는 GPU 하드웨어/클라우드 자원 견적 (공급사로부터 받은 견적)

competitor_pricing인 경우 JSON 반환:
{
  "type": "competitor",
  "items": [
    {
      "competitor_name": "회사명",
      "model_name": "H100",
      "memory": "80GB",
      "price_usd": 2.39,
      "pricing_model": "on-demand"
    }
  ]
}

pricing_model 값: "on-demand" | "reserved-1y" | "reserved-3y" | "spot"
memory 값: "80GB", "40GB", "24GB" 등 숫자+단위

supplier_quote이거나 GPU 가격이 아닌 경우:
{ "type": "supplier" }

JSON만 반환. 설명 없이.`

// 경쟁사 가격 DB 저장 (자동 upsert)
async function saveCompetitorPrices(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  items: CompetitorPriceItem[],
  sourceUrl: string | null,
): Promise<{ competitor: string; model: string; memory: string; price_usd: number }[]> {
  const saved: { competitor: string; model: string; memory: string; price_usd: number }[] = []
  const now = new Date().toISOString()

  for (const item of items) {
    if (!item.competitor_name || !item.model_name || !item.price_usd) continue

    // 1. 경쟁사 find or create
    let competitorId: string
    const { data: existingComp } = await db
      .from('competitors')
      .select('id')
      .ilike('name', item.competitor_name.trim())
      .single()

    if (existingComp?.id) {
      competitorId = existingComp.id
    } else {
      const compName = item.competitor_name.trim()
      const { data: newComp, error: compErr } = await db
        .from('competitors')
        .insert({
          name: compName,
          short_name: compName.slice(0, 20),
          type: 'cloud_provider',
        })
        .select('id')
        .single()
      if (compErr || !newComp) {
        console.error('[competitor] 경쟁사 생성 실패:', compErr?.message)
        continue
      }
      competitorId = newComp.id
    }

    // 2. GPU 모델 find or create
    let gpuProductId: string
    const memory = item.memory?.trim() ?? ''
    const { data: existingGpu } = await db
      .from('gpu_products')
      .select('id')
      .ilike('model_name', item.model_name.trim())
      .eq('memory', memory)
      .single()

    if (existingGpu?.id) {
      gpuProductId = existingGpu.id
    } else {
      const { data: newGpu, error: gpuErr } = await db
        .from('gpu_products')
        .insert({
          model_name: item.model_name.trim(),
          memory,
          tier: 1,
          pricing_mode: 'on-demand',
          gpu_count: 1,
          vcpu: 12,
          ram_gb: 16,
          storage_gb: 512,
        })
        .select('id')
        .single()
      if (gpuErr || !newGpu) {
        console.error('[competitor] GPU 모델 생성 실패:', gpuErr?.message)
        continue
      }
      gpuProductId = newGpu.id
    }

    // 3. 매핑 find or create
    let mappingId: string
    const pricingModel = (item.pricing_model ?? 'on_demand').replace(/-/g, '_')
    const { data: existingMap } = await db
      .from('competitor_product_mapping')
      .select('id')
      .eq('competitor_id', competitorId)
      .eq('gpu_product_id', gpuProductId)
      .eq('pricing_model', pricingModel)
      .single()

    if (existingMap?.id) {
      mappingId = existingMap.id
    } else {
      const sku = `${item.model_name} ${memory} (${pricingModel})`.trim()
      const { data: newMap, error: mapErr } = await db
        .from('competitor_product_mapping')
        .insert({ competitor_id: competitorId, gpu_product_id: gpuProductId, competitor_sku: sku, pricing_model: pricingModel, is_active: true })
        .select('id')
        .single()
      if (mapErr || !newMap) {
        console.error('[competitor] 매핑 생성 실패:', mapErr?.message)
        continue
      }
      mappingId = newMap.id
    }

    // 4. 시장 가격 등록
    await db.from('market_prices').insert({
      mapping_id: mappingId,
      price_usd: item.price_usd,
      source_url: sourceUrl,
      source_type: sourceUrl ? 'webpage' : 'manual',
      recorded_at: now,
      observed_at: now,
      confidence: 85,
      is_stale: false,
    })

    saved.push({ competitor: item.competitor_name, model: item.model_name, memory, price_usd: item.price_usd })
  }

  return saved
}

// GET /api/pricing/gpu/review — 검토 대기 목록
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? 'pending'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('review_items')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ items: (data ?? []) as ReviewItem[] })
}

// POST /api/pricing/gpu/review — 새 review_item 생성 (통합 입력 → AI 분석)
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const supabase = await createClient()
  const user = auth.user

  let body: {
    text?: unknown
    channel?: unknown
    is_test?: unknown
    evidence_drive_file_id?: unknown
    imageData?: unknown
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const rawInputText = typeof body.text === 'string' ? body.text.trim() : ''
  const imgInput = (body.imageData && typeof body.imageData === 'object')
    ? body.imageData as { data?: unknown; mimeType?: unknown }
    : null
  const imageBase64 = typeof imgInput?.data === 'string' ? imgInput.data : null
  const imageMimeType = typeof imgInput?.mimeType === 'string' ? imgInput.mimeType : 'image/jpeg'

  if (!rawInputText && !imageBase64) return NextResponse.json({ error: '분석할 텍스트 또는 이미지가 없습니다' }, { status: 400 })

  const channel = typeof body.channel === 'string' ? body.channel : 'own'
  const isTest = body.is_test === true
  const driveFileId = typeof body.evidence_drive_file_id === 'string' ? body.evidence_drive_file_id : null

  const adminClient = createAdminClient()
  const config = await getGeminiConfig(adminClient)
  if (!config.apiKey) return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다' }, { status: 500 })

  // ── URL 감지 및 fetch ──────────────────────────────
  const urlMatch = rawInputText.match(/https?:\/\/[^\s]+/)
  const sourceUrl = urlMatch?.[0] ?? null
  let contentText = rawInputText

  if (sourceUrl && !imageBase64) {
    const fetched = await fetchUrlText(sourceUrl)
    if (fetched) contentText = fetched
  }

  // ── AI 1단계: 입력 분류 (경쟁사 vs 공급가) ──────────
  if (!imageBase64) {
    const classifyParts: Array<{ text: string }> = [
      { text: `${CLASSIFY_PROMPT}\n\n입력:\n${contentText}` },
    ]
    let classifyRes: Response
    try {
      classifyRes = await callGemini(config.apiKey, config.model, classifyParts)
    } catch {
      return NextResponse.json({ error: 'AI 서버 연결 실패' }, { status: 502 })
    }

    if (classifyRes.ok) {
      const classifyJson = await classifyRes.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      const classifyRaw = classifyJson.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      try {
        const classified = JSON.parse(classifyRaw) as {
          type: 'competitor' | 'supplier'
          items?: CompetitorPriceItem[]
        }

        if (classified.type === 'competitor' && Array.isArray(classified.items) && classified.items.length > 0) {
          // ── 경쟁사 가격 저장 경로 ──────────────────────
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const db = supabase as any
          const saved = await saveCompetitorPrices(db, classified.items, sourceUrl)

          if (saved.length === 0) {
            return NextResponse.json({ error: 'AI가 유효한 경쟁사 가격을 추출하지 못했습니다' }, { status: 422 })
          }

          return NextResponse.json({ type: 'competitor', saved, count: saved.length, source_url: sourceUrl })
        }
      } catch {
        // 분류 실패 → supplier 플로우로 폴백
        console.warn('[review POST] 분류 파싱 실패, supplier 플로우로 폴백')
      }
    }
  }

  // ── 공급가 견적 처리 (기존 플로우) ─────────────────
  const prompt = await getPrompt(adminClient)
  if (!prompt) return NextResponse.json({ error: 'AI 프롬프트가 설정되지 않았습니다' }, { status: 500 })

  const promptText = `${prompt.content}\n\n${contentText ? '입력 텍스트:\n' + contentText : '위 이미지에서 GPU 견적 정보를 추출하세요.'}`
  const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = []
  if (imageBase64) parts.push({ inlineData: { data: imageBase64, mimeType: imageMimeType } })
  parts.push({ text: promptText })

  let geminiRes: Response
  try {
    geminiRes = await callGemini(config.apiKey, config.model, parts)
  } catch {
    return NextResponse.json({ error: 'AI 서버 연결 실패' }, { status: 502 })
  }

  if (!geminiRes.ok) {
    return NextResponse.json({ error: `AI API 오류 (${geminiRes.status})` }, { status: 502 })
  }

  const geminiJson = await geminiRes.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
  }

  const rawText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const usage = geminiJson.usageMetadata ?? {}

  logTokenUsage({
    userId: user.id,
    feature: 'gpu-quote-extract',
    model: config.model,
    promptTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
    totalTokens: usage.totalTokenCount ?? 0,
  })

  type SingleExtracted = {
    extracted?: Record<string, unknown>
    confidence?: Record<string, number | null>
    evidence?: Record<string, string | null>
    impact_assessment?: { level?: string; label?: string; note?: string }
  }
  type MultiExtracted = { items?: SingleExtracted[] }

  let parsed: SingleExtracted & MultiExtracted
  try { parsed = JSON.parse(rawText) } catch {
    console.error('[review POST] AI 응답 파싱 실패:', rawText.slice(0, 200))
    return NextResponse.json({ error: 'AI 응답 파싱 실패' }, { status: 500 })
  }

  if (Array.isArray(parsed.items) && parsed.items.length === 0) {
    return NextResponse.json({ error: 'AI가 GPU 모델을 인식하지 못했습니다' }, { status: 422 })
  }
  const itemsList: SingleExtracted[] = Array.isArray(parsed.items)
    ? parsed.items.slice(0, 50)
    : [{ extracted: parsed.extracted, confidence: parsed.confidence, evidence: parsed.evidence, impact_assessment: parsed.impact_assessment }]

  const batchId = crypto.randomUUID()

  const insertRows = itemsList.map((item, idx) => {
    const conf = item.confidence ?? {}
    const confValues = Object.values(conf).filter((v): v is number => typeof v === 'number')
    const overallConf = confValues.length > 0
      ? Math.round(confValues.reduce((a, b) => a + b, 0) / confValues.length)
      : null
    const impactLevel = (item.impact_assessment?.level ?? 'steady') as string

    return {
      source_input_id: driveFileId,
      source_batch_id: itemsList.length > 1 ? batchId : null,
      batch_index: idx,
      product_hint: typeof item.extracted?.model_name === 'string'
        ? `${item.extracted.model_name} ${item.extracted.memory ?? ''}`.trim()
        : null,
      supplier_hint: typeof item.extracted?.supplier === 'string' ? item.extracted.supplier : null,
      channel,
      impact_level: impactLevel,
      status: 'pending',
      current_iteration: 1,
      current_extracted: item.extracted ?? null,
      current_confidence: item.confidence ?? null,
      overall_confidence: overallConf,
      is_test: isTest,
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: insertedItems, error: insertError } = await (supabase as any)
    .from('review_items')
    .insert(insertRows)
    .select()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  const insertedArr = (insertedItems ?? []) as ReviewItem[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: iterError } = await (supabase as any)
    .from('review_iterations')
    .insert(
      insertedArr.map((dbItem, idx) => ({
        review_item_id: dbItem.id,
        iteration_no: 1,
        extracted: itemsList[idx]?.extracted ?? {},
        confidence: itemsList[idx]?.confidence ?? {},
        evidence: itemsList[idx]?.evidence ?? {},
        user_feedback: null,
        ai_model_used: config.model,
        prompt_version: prompt.version,
        is_test: isTest,
      }))
    )
  if (iterError) console.error('[review POST] review_iterations insert failed:', iterError.message)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: auditError } = await (adminClient as any)
    .from('gpu_audit_logs')
    .insert({
      actor: user.email ?? user.id,
      action_type: 'review_created',
      detail: {
        batch_id: itemsList.length > 1 ? batchId : null,
        count: insertedArr.length,
        review_item_ids: insertedArr.map((i) => i.id),
        is_test: isTest,
      },
    })
  if (auditError) console.error('[review POST] gpu_audit_logs insert failed:', auditError.message)

  if (insertedArr.length === 1) {
    return NextResponse.json({ type: 'supplier', item: insertedArr[0] })
  }
  return NextResponse.json({ type: 'supplier', items: insertedArr, count: insertedArr.length, batch_id: batchId })
}
