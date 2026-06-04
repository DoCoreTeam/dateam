import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { logTokenUsage } from '@/lib/token-logger'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

// POST /api/pricing/gpu/specs/generate
//  body: { model_name } 단일  |  { all: true } 스펙 없는 모델 일괄
//  디폴트 = AI가 무조건 작성. 모델명 기반 데이터시트를 추출해 upsert(ai_generated=true).
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: { model_name?: string; all?: boolean }
  try { body = await req.json() } catch { body = {} }

  const supabase = await createClient()
  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient as any

  // 대상 모델 목록
  let targets: string[] = []
  if (body.model_name) {
    targets = [body.model_name]
  } else if (body.all) {
    // 부족 정보 보완 — gpu_specs 행이 없거나 칩 데이터시트(architecture)가 비어있는 모델 전부
    const { data: products } = await (supabase as any).from('gpu_products').select('model_name') // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: specs } = await db.from('gpu_specs').select('model_name, architecture')
    const complete = new Set((specs ?? []).filter((s: { architecture: string | null }) => s.architecture).map((s: { model_name: string }) => s.model_name))
    const distinct = Array.from(new Set((products ?? []).map((p: { model_name: string }) => p.model_name)))
    targets = (distinct as string[]).filter((m) => !complete.has(m))
  }
  if (targets.length === 0) return NextResponse.json({ error: '대상 모델이 없습니다' }, { status: 400 })

  // AI 키
  const { data: metaRow } = await db.from('org_content').select('value').eq('key', 'META').single()
  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : ''
  const model = typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash'
  if (!apiKey) return NextResponse.json({ error: 'AI 키가 설정되지 않았습니다' }, { status: 500 })

  const results: Array<{ model_name: string; ok: boolean; error?: string }> = []

  for (const modelName of targets.slice(0, 60)) { // 안전 상한
    const prompt = `당신은 NVIDIA/데이터센터 GPU 사양 전문가입니다. 아래 GPU 모델의 공식 데이터시트 사양을 추출하세요. 모르는 값은 null로 두되, 추정하지 말고 알려진 사실만 채우세요.

## 모델
${modelName}

## 출력 (JSON만)
{
  "architecture": "<예: Hopper, Ada Lovelace, Ampere>",
  "vram_gb": <카드당 VRAM GB, 정수>,
  "vram_type": "<HBM3 | HBM2e | GDDR6X 등>",
  "cuda_cores": <정수 또는 null>,
  "tensor_cores": <정수 또는 null>,
  "fp16_tflops": <숫자 또는 null>,
  "bf16_tflops": <숫자 또는 null>,
  "fp8_tflops": <숫자 또는 null>,
  "nvlink": <true|false|null>,
  "nvlink_bandwidth": "<예: 900 GB/s 또는 null>",
  "tdp_w": <정수 W 또는 null>,
  "interface": "<PCIe | SXM | null>",
  "mig_support": <true|false|null>,
  "release_year": <정수 또는 null>,
  "confidence": <0-100, 데이터시트 확신도>
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
      results.push({ model_name: modelName, ok: false, error: 'AI 연결 실패' }); continue
    }
    if (!res.ok) { results.push({ model_name: modelName, ok: false, error: `AI ${res.status}` }); continue }

    const j = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    }
    const rawText = j.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const usage = j.usageMetadata ?? {}
    logTokenUsage({
      userId: auth.user.id, feature: 'gpu-spec-generate', model,
      promptTokens: usage.promptTokenCount ?? 0, outputTokens: usage.candidatesTokenCount ?? 0, totalTokens: usage.totalTokenCount ?? 0,
    })

    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(rawText) } catch { results.push({ model_name: modelName, ok: false, error: '파싱 실패' }); continue }

    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : null
    delete parsed.confidence
    const { error } = await db.from('gpu_specs').upsert({
      model_name: modelName,
      ...parsed,
      ai_generated: true,
      ai_confidence: confidence,
      ai_model: model,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'model_name' })
    results.push({ model_name: modelName, ok: !error, error: error?.message })
  }

  return NextResponse.json({ generated: results.filter((r) => r.ok).length, total: targets.length, results })
}
