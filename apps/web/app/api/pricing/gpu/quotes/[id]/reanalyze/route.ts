import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { logTokenUsage } from '@/lib/token-logger'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

// POST /api/pricing/gpu/quotes/[id]/reanalyze — 견적의 원본 값 + 메모를 AI로 재정규화(제안만)
// 확정 견적엔 원문 텍스트가 없으므로, 저장된 원본(단가/단위/통화/모델/메모)을 입력으로 재분석한다.
// 결과는 "제안"으로만 반환 — 실제 적용(저장)은 사용자가 PATCH로 확정.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params

  let body: { memo?: unknown }
  try { body = await req.json() } catch { body = {} }
  const memo = typeof body.memo === 'string' ? body.memo.trim() : ''

  const supabase = await createClient()
  const adminClient = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: q } = await (supabase as any)
    .from('supply_quotes')
    .select('*, gpu_products(model_name, memory, gpu_count, tier)')
    .eq('id', id)
    .single()
  if (!q) return NextResponse.json({ error: '견적을 찾을 수 없습니다' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: metaRow } = await (adminClient as any).from('org_content').select('value').eq('key', 'META').single()
  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash'
  if (!apiKey) return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다' }, { status: 500 })

  const prod = q.gpu_products as Record<string, unknown> | null
  const source = {
    model_name: prod?.model_name ?? null,
    memory: prod?.memory ?? null,
    product_gpu_count: prod?.gpu_count ?? null,
    저장된_unit_price_usd: q.unit_price_usd,
    저장된_gpu_count: q.gpu_count,
    original_price: q.original_price,
    original_currency: q.original_currency,
    original_unit: q.original_unit,
    term: q.term,
    min_qty: q.min_qty,
    memo: memo || null,
  }

  const prompt = `당신은 GPU 공급 견적 정규화 전문가입니다. 아래 견적의 "원본 입력값"을 재분석하여 정확한 구조를 추출하세요.

## 단위 표준 (반드시 준수)
- unit_price_usd = 그 구성(gpu_count) 전체의 시간당 총액(USD). 1장당이 아니라 구성 총액.
- gpu_count = 그 구성의 GPU 장수. 메모리(예: 640GB=80GB×8 → 8장) 단서를 활용.
- price_basis = "per_gpu" | "per_set" | "box_total" 중 원본이 어떤 기준인지.
- min_qty(최소주문수량)와 gpu_count(구성 장수)를 혼동하지 말 것. "8장 이상"은 min_qty이지 gpu_count 아님.

## 원본 입력값
${JSON.stringify(source, null, 2)}

## 출력 (JSON만)
{
  "gpu_count": <정수>,
  "price_basis": "per_gpu|per_set|box_total",
  "unit_price_usd": <구성 총액 USD, 숫자>,
  "per_gpu_usd": <1장당 = unit_price_usd / gpu_count>,
  "reason": "<재분석 근거 한국어 1-2문장>",
  "confidence": <0-100>
}`

  let res: Response
  try {
    res = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
    })
  } catch {
    return NextResponse.json({ error: 'AI 서버 연결 실패' }, { status: 502 })
  }
  if (!res.ok) return NextResponse.json({ error: `AI 오류 (${res.status})` }, { status: 502 })

  const j = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
  }
  const rawText = j.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const usage = j.usageMetadata ?? {}
  logTokenUsage({
    userId: auth.user.id, feature: 'gpu-quote-reanalyze', model,
    promptTokens: usage.promptTokenCount ?? 0, outputTokens: usage.candidatesTokenCount ?? 0, totalTokens: usage.totalTokenCount ?? 0,
  })

  let suggestion: Record<string, unknown>
  try { suggestion = JSON.parse(rawText) } catch {
    return NextResponse.json({ error: 'AI 응답 파싱 실패', raw: rawText }, { status: 500 })
  }

  return NextResponse.json({
    suggestion,
    current: { unit_price_usd: q.unit_price_usd, gpu_count: q.gpu_count },
  })
}
