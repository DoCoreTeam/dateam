import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

// POST /api/pricing/gpu/review/[id]/recheck — AI 재분석 요청
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const supabase = await createClient()
  const user = auth.user

  const { id } = await params

  let body: { feedback?: unknown; original_text?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : ''
  const originalText = typeof body.original_text === 'string' ? body.original_text : ''

  if (!feedback) return NextResponse.json({ error: '피드백을 입력해 주세요' }, { status: 400 })

  const adminClient = createAdminClient()

  // 현재 review_item 조회
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: item } = await (supabase as any)
    .from('review_items')
    .select('*')
    .eq('id', id)
    .single()

  if (!item) return NextResponse.json({ error: '검토 항목 없음' }, { status: 404 })
  if (item.status !== 'pending') return NextResponse.json({ error: '이미 처리된 항목' }, { status: 409 })

  // Gemini 설정 + 프롬프트 로드
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: metaRow }, { data: promptRow }] = await Promise.all([
    (adminClient as any).from('org_content').select('value').eq('key', 'META').single(),
    (adminClient as any).from('ai_prompts').select('content, version, model_hint')
      .eq('prompt_key', 'gpu.quote-extract').eq('active', true).single(),
  ])

  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash'

  if (!apiKey) return NextResponse.json({ error: 'AI 키 없음' }, { status: 500 })
  if (!promptRow) return NextResponse.json({ error: '프롬프트 없음' }, { status: 500 })

  const nextIteration = item.current_iteration + 1

  const recheckPrompt = `${promptRow.content}

## 이전 추출 결과 (${item.current_iteration}차)
${JSON.stringify(item.current_extracted, null, 2)}

## 본부장 피드백
${feedback}

위 피드백을 반영하여 원본 텍스트를 재분석하고, 동일한 JSON 형식으로 반환하세요.

원본 텍스트:
${originalText || '(원본 텍스트 없음 — 이전 추출 결과 기반으로 피드백 반영)'}`

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`

  let geminiRes: Response
  try {
    geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: recheckPrompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
    })
  } catch {
    return NextResponse.json({ error: 'AI 서버 연결 실패' }, { status: 502 })
  }

  if (!geminiRes.ok) {
    return NextResponse.json({ error: `AI 오류 (${geminiRes.status})` }, { status: 502 })
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
    model,
    promptTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
    totalTokens: usage.totalTokenCount ?? 0,
  })

  let reExtracted: {
    extracted?: Record<string, unknown>
    confidence?: Record<string, number | null>
    evidence?: Record<string, string | null>
    impact_assessment?: { level?: string; label?: string; note?: string }
  }
  try { reExtracted = JSON.parse(rawText) } catch {
    return NextResponse.json({ error: 'AI 응답 파싱 실패', raw: rawText }, { status: 500 })
  }

  const confidence = reExtracted.confidence ?? {}
  const values = Object.values(confidence).filter((v): v is number => typeof v === 'number')
  const overallConfidence = values.length > 0
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : item.overall_confidence

  // review_iterations N차 저장
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('review_iterations')
    .insert({
      review_item_id: id,
      iteration_no: nextIteration,
      extracted: reExtracted.extracted ?? {},
      confidence: reExtracted.confidence ?? {},
      evidence: reExtracted.evidence ?? {},
      user_feedback: feedback,
      ai_model_used: model,
      prompt_version: promptRow.version,
      is_test: item.is_test,
    })

  // review_items 현재값 업데이트 (이전 회차는 review_iterations에 보존됨)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated } = await (supabase as any)
    .from('review_items')
    .update({
      current_iteration: nextIteration,
      current_extracted: reExtracted.extracted ?? item.current_extracted,
      current_confidence: reExtracted.confidence ?? item.current_confidence,
      overall_confidence: overallConfidence,
    })
    .eq('id', id)
    .select()
    .single()

  // audit_log (gpu_audit_logs는 service_role 전용 — adminClient 사용)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient as any)
    .from('gpu_audit_logs')
    .insert({
      actor: user.email ?? user.id,
      action_type: 'review_recheck_completed',
      detail: {
        review_item_id: id,
        iteration_no: nextIteration,
        feedback,
        overall_confidence: overallConfidence,
      },
    })

  return NextResponse.json({
    item: updated,
    extracted: reExtracted,
    iteration: nextIteration,
  })
}
