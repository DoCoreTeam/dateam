import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { loadSchemaDigest } from '@/lib/gpu/extract-helpers'
import { diffExtracted, normalizeReanalysis } from '@/lib/gpu/extract-diff'
import { BILLING_EXTRACT_HINT } from '@/lib/gpu/billing'

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

  // 입력 길이 상한 — 토큰 비용 폭주/DoS 방어
  const MAX_FEEDBACK = 4000
  const MAX_ORIGINAL = 100_000
  const feedback = (typeof body.feedback === 'string' ? body.feedback.trim() : '').slice(0, MAX_FEEDBACK)
  const originalText = (typeof body.original_text === 'string' ? body.original_text : '').slice(0, MAX_ORIGINAL)

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
  const schema = await loadSchemaDigest(adminClient)

  const recheckPrompt = `${promptRow.content}

## DB 스키마 (정합 유지 — 실제 테이블·컬럼·enum)
${schema}
${BILLING_EXTRACT_HINT}

## 이전 추출 결과 (${item.current_iteration}차)
${JSON.stringify(item.current_extracted, null, 2)}

## 본부장 피드백
${feedback}

위 피드백을 반영하여 원본 텍스트를 재분석하고, 동일한 JSON 형식으로 반환하세요.
추가로, 최상위에 "change_summary" 필드(한국어 1~3문장)를 포함하세요 — 이전 추출 대비 **무엇을 어떻게 바꿨는지와 그 근거**를 사람이 읽을 수 있게 설명합니다. 바꾼 것이 없으면 그 이유를 적으세요.

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
    change_summary?: string
    [k: string]: unknown
  }
  try { reExtracted = JSON.parse(rawText) } catch {
    return NextResponse.json({ error: 'AI 응답 파싱 실패', raw: rawText }, { status: 500 })
  }

  // AI 응답 형태 견고화 — 단일 {extracted}/멀티 {items:[{extracted}]}/평탄 JSON 모두 수용(SSOT 헬퍼).
  // (형태 미스매치로 재분석이 조용히 무시되고 diff after=null이 되던 버그 교정)
  const { extracted: newExtracted, confidence, evidence: newEvidence } = normalizeReanalysis(
    reExtracted, (item.current_extracted ?? {}) as Record<string, unknown>,
  )
  const values = Object.values(confidence).filter((v): v is number => typeof v === 'number')
  const overallConfidence = values.length > 0
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : item.overall_confidence

  // 재분석 결과 리포트 — 이전 추출 vs 새 추출 필드 diff(SSOT) + AI 근거.
  // 프론트가 "무엇이 왜 바뀌었는지"를 숨김 없이 보여주기 위함.
  const prevExtracted = (item.current_extracted ?? {}) as Record<string, unknown>
  const diff = diffExtracted(prevExtracted, newExtracted)
  const changeSummary = typeof reExtracted.change_summary === 'string' ? reExtracted.change_summary.trim() : ''

  // review_iterations N차 저장 (092 RLS: service_role 전용 → adminClient)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient as any)
    .from('review_iterations')
    .insert({
      review_item_id: id,
      iteration_no: nextIteration,
      extracted: newExtracted,
      confidence,
      evidence: newEvidence,
      user_feedback: feedback,
      ai_model_used: model,
      prompt_version: promptRow.version,
      is_test: item.is_test,
    })

  // review_items 현재값 업데이트 (이전 회차는 review_iterations에 보존됨) — 092 RLS: adminClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated } = await (adminClient as any)
    .from('review_items')
    .update({
      current_iteration: nextIteration,
      current_extracted: newExtracted,
      current_confidence: Object.keys(confidence).length > 0 ? confidence : item.current_confidence,
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
        change_summary: changeSummary || null,
        changed_fields: diff.map((d) => d.field),
      },
    })

  return NextResponse.json({
    item: updated,
    extracted: reExtracted,
    iteration: nextIteration,
    change_summary: changeSummary,
    diff,
  })
}
