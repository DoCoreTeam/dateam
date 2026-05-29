import { NextRequest, NextResponse } from 'next/server'
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

  const [products, quotes, auditLogs, suppliers, fxRates, settings, reviewItems] =
    await Promise.all([
      sb.from('gpu_products').select('id,model_name,memory,tier').order('tier').limit(30),
      sb.from('supply_quotes')
        .select('id,product_id,supplier_id,unit_price_usd,term,term_months,valid_until,status,received_at,registered_by,confirmed_by,confirmed_at')
        .gte('received_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
        .order('received_at', { ascending: false })
        .limit(100),
      sb.from('gpu_audit_logs')
        .select('ts,actor,action_type,detail,product_id')
        .gte('ts', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('ts', { ascending: false })
        .limit(150),
      sb.from('suppliers').select('id,name,country,tier'),
      sb.from('fx_rates').select('usd_krw,date').order('date', { ascending: false }).limit(1),
      sb.from('pricing_settings').select('margin_pct').limit(1),
      sb.from('review_items')
        .select('id,product_hint,supplier_hint,status,overall_confidence,confirmed_at,created_at')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(50),
    ])

  // 공급사 ID → 이름 매핑
  const supplierMap: Record<string, string> = {}
  for (const s of suppliers.data ?? []) supplierMap[s.id] = s.name

  // quotes에 supplier_name 주입
  const enrichedQuotes = (quotes.data ?? []).map((q: Record<string, unknown>) => ({
    ...q,
    supplier_name: typeof q.supplier_id === 'string' ? (supplierMap[q.supplier_id] ?? null) : null,
  }))

  return {
    gpu_products: products.data ?? [],
    supply_quotes: enrichedQuotes,
    gpu_audit_logs: auditLogs.data ?? [],
    suppliers: suppliers.data ?? [],
    fx_rates: fxRates.data?.[0] ?? null,
    pricing_settings: settings.data?.[0] ?? null,
    review_items: reviewItems.data ?? [],
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

  // 멀티턴: history + 새 질문을 Gemini contents 배열로 변환
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = []
  for (const msg of history) {
    contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] })
  }
  contents.push({ role: 'user', parts: [{ text: query }] })

  const url = `${GEMINI_API_BASE}/models/${config.model}:generateContent`
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
    feature: 'gpu-db-chat',
    model: config.model,
    promptTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
    totalTokens: usage.totalTokenCount ?? 0,
  })

  let parsed: ChatResponse
  try {
    parsed = JSON.parse(rawText)
  } catch {
    console.error('[db-chat] AI 응답 파싱 실패:', rawText.slice(0, 200))
    return NextResponse.json({ error: 'AI 응답 파싱 실패' }, { status: 500 })
  }

  return NextResponse.json({
    answer: typeof parsed.answer === 'string' ? parsed.answer : '',
    data: Array.isArray(parsed.data) ? parsed.data : [],
    source_tables: Array.isArray(parsed.source_tables) ? parsed.source_tables : [],
    found: parsed.found === true,
  })
}
