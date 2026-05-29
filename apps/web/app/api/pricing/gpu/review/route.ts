import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

interface ReviewItem {
  id: string
  source_input_id: string | null
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
  // user는 admin gate를 통과했으므로 auth.user 사용
  const user = auth.user

  let body: {
    text?: unknown
    channel?: unknown
    is_test?: unknown
    evidence_drive_file_id?: unknown
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: '분석할 텍스트가 없습니다' }, { status: 400 })

  const channel = typeof body.channel === 'string' ? body.channel : 'own'
  const isTest = body.is_test === true
  const driveFileId = typeof body.evidence_drive_file_id === 'string' ? body.evidence_drive_file_id : null

  const adminClient = createAdminClient()
  const [config, prompt] = await Promise.all([
    getGeminiConfig(adminClient),
    getPrompt(adminClient),
  ])

  if (!config.apiKey) return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다' }, { status: 500 })
  if (!prompt) return NextResponse.json({ error: 'AI 프롬프트가 설정되지 않았습니다' }, { status: 500 })

  const url = `${GEMINI_API_BASE}/models/${config.model}:generateContent`

  let geminiRes: Response
  try {
    geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${prompt.content}\n\n입력 텍스트:\n${text}` }] }],
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

  // 토큰 로깅 (fire-and-forget)
  logTokenUsage({
    userId: user.id,
    feature: 'gpu-quote-extract',
    model: config.model,
    promptTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
    totalTokens: usage.totalTokenCount ?? 0,
  })

  let extracted: {
    extracted?: Record<string, unknown>
    confidence?: Record<string, number | null>
    evidence?: Record<string, string | null>
    impact_assessment?: { level?: string; label?: string; note?: string }
  }
  try { extracted = JSON.parse(rawText) } catch {
    return NextResponse.json({ error: 'AI 응답 파싱 실패', raw: rawText }, { status: 500 })
  }

  const confidence = extracted.confidence ?? {}
  const values = Object.values(confidence).filter((v): v is number => typeof v === 'number')
  const overallConfidence = values.length > 0
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : null

  const impactLevel = (extracted.impact_assessment?.level ?? 'steady') as
    'new_model' | 'price_low_change' | 'big_swing' | 'steady'

  // review_item 생성
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: item, error: insertError } = await (supabase as any)
    .from('review_items')
    .insert({
      source_input_id: driveFileId,
      product_hint: typeof extracted.extracted?.model_name === 'string'
        ? `${extracted.extracted.model_name} ${extracted.extracted.memory ?? ''}`.trim()
        : null,
      supplier_hint: typeof extracted.extracted?.supplier === 'string'
        ? extracted.extracted.supplier
        : null,
      channel,
      impact_level: impactLevel,
      status: 'pending',
      current_iteration: 1,
      current_extracted: extracted.extracted ?? null,
      current_confidence: extracted.confidence ?? null,
      overall_confidence: overallConfidence,
      is_test: isTest,
    })
    .select()
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  // review_iterations 1차 기록
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('review_iterations')
    .insert({
      review_item_id: item.id,
      iteration_no: 1,
      extracted: extracted.extracted ?? {},
      confidence: extracted.confidence ?? {},
      evidence: extracted.evidence ?? {},
      user_feedback: null,
      ai_model_used: config.model,
      prompt_version: prompt.version,
      is_test: isTest,
    })

  // audit_log
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('gpu_audit_logs')
    .insert({
      actor: user.email ?? user.id,
      action_type: 'review_created',
      detail: {
        review_item_id: item.id,
        product_hint: item.product_hint,
        supplier_hint: item.supplier_hint,
        overall_confidence: overallConfidence,
        is_test: isTest,
      },
    })

  return NextResponse.json({ item })
}
