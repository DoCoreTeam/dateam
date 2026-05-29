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
    imageData?: unknown
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const imgInput = (body.imageData && typeof body.imageData === 'object')
    ? body.imageData as { data?: unknown; mimeType?: unknown }
    : null
  const imageBase64 = typeof imgInput?.data === 'string' ? imgInput.data : null
  const imageMimeType = typeof imgInput?.mimeType === 'string' ? imgInput.mimeType : 'image/jpeg'

  if (!text && !imageBase64) return NextResponse.json({ error: '분석할 텍스트 또는 이미지가 없습니다' }, { status: 400 })

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

  const promptText = `${prompt.content}\n\n${text ? '입력 텍스트:\n' + text : '위 이미지에서 GPU 견적 정보를 추출하세요.'}`
  const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = []
  if (imageBase64) parts.push({ inlineData: { data: imageBase64, mimeType: imageMimeType } })
  parts.push({ text: promptText })

  let geminiRes: Response
  try {
    geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
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

  // v2.0 프롬프트: items 배열 / v1.x 하위 호환: items 키 자체가 없을 때만 단일 객체로 래핑
  // parsed.items === [] (빈 배열)은 "모델 없음"이므로 래핑하지 않고 400 반환
  if (Array.isArray(parsed.items) && parsed.items.length === 0) {
    return NextResponse.json({ error: 'AI가 GPU 모델을 인식하지 못했습니다' }, { status: 422 })
  }
  const itemsList: SingleExtracted[] = Array.isArray(parsed.items)
    ? parsed.items.slice(0, 50) // 최대 50개 배치 제한
    : [{ extracted: parsed.extracted, confidence: parsed.confidence, evidence: parsed.evidence, impact_assessment: parsed.impact_assessment }]

  const batchId = crypto.randomUUID()

  // N건 배치 insert
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

  // review_iterations 배치 기록 (실패해도 롤백 불가 — 로그만 남김)
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

  // audit_log (실패해도 비치명적)
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

  // 하위 호환: 단일 모델이면 item(단수), 복수면 items+count+batch_id
  if (insertedArr.length === 1) {
    return NextResponse.json({ item: insertedArr[0] })
  }
  return NextResponse.json({ items: insertedArr, count: insertedArr.length, batch_id: batchId })
}
