import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import type { CompetitorPriceItem } from '@/lib/gpu/competitor-import'
import { SCHEMA_CONTRACT } from '@/lib/gpu/schema-contract'

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

// 분류 프롬프트를 DB(ai_prompts)에서 로드 — 코드 하드코딩 탈피(S3). 미존재 시 아래 CLASSIFY_PROMPT 폴백.
async function getClassifyPrompt(adminClient: ReturnType<typeof createAdminClient>): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (adminClient as any)
      .from('ai_prompts')
      .select('content')
      .eq('prompt_key', 'gpu.input-classify')
      .eq('active', true)
      .single()
    const c = data?.content
    return typeof c === 'string' && c.trim().length > 0 ? c : CLASSIFY_PROMPT
  } catch {
    return CLASSIFY_PROMPT
  }
}

// 보유 GPU 모델 카탈로그(스펙 포함) — 클라우드사의 가상/인스턴스 모델명을 스펙으로 대조해
// 우리 표준 model_name으로 매핑하도록 AI에 주입 (P3 + 스펙 기반 매핑).
// 고정 스키마(gpu_products + gpu_specs)에서 런타임 파생 — 별도 매개체 불필요.
async function loadSpecContext(adminClient: ReturnType<typeof createAdminClient>): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = adminClient as any
    const [prodRes, specRes] = await Promise.all([
      db.from('gpu_products').select('model_name, memory').order('model_name', { ascending: true }).limit(300),
      db.from('gpu_specs').select('model_name, architecture, vram_gb, vram_type, interface').limit(300),
    ])
    const prods = (prodRes.data ?? []) as Array<{ model_name: string | null; memory: string | null }>
    const specs = (specRes.data ?? []) as Array<{
      model_name: string | null; architecture: string | null; vram_gb: number | null; vram_type: string | null; interface: string | null
    }>

    // 표준 모델명 집합 — gpu_products 기준
    const canonical = new Set<string>()
    for (const p of prods) { const n = (p.model_name ?? '').trim(); if (n) canonical.add(n) }
    if (canonical.size === 0) return ''

    // 모델별 스펙 인덱스
    const specByModel = new Map<string, { arch?: string; vram?: number; vramType?: string; iface?: string }>()
    for (const s of specs) {
      const n = (s.model_name ?? '').trim()
      if (!n) continue
      specByModel.set(n, {
        arch: s.architecture ?? undefined,
        vram: s.vram_gb ?? undefined,
        vramType: s.vram_type ?? undefined,
        iface: s.interface ?? undefined,
      })
    }

    // 카탈로그 라인: "H100 (VRAM 80GB HBM3, Hopper, SXM)" 형태 — 스펙 없으면 메모리만
    const memByModel = new Map<string, Set<string>>()
    for (const p of prods) {
      const n = (p.model_name ?? '').trim(); if (!n) continue
      if (p.memory) { if (!memByModel.has(n)) memByModel.set(n, new Set()); memByModel.get(n)!.add(p.memory) }
    }
    const lines: string[] = []
    for (const name of Array.from(canonical).sort()) {
      const sp = specByModel.get(name)
      const parts: string[] = []
      if (sp?.vram) parts.push(`VRAM ${sp.vram}GB${sp.vramType ? ' ' + sp.vramType : ''}`)
      else if (memByModel.get(name)?.size) parts.push(`VRAM ${Array.from(memByModel.get(name)!).join('/')}`)
      if (sp?.arch) parts.push(sp.arch)
      if (sp?.iface) parts.push(sp.iface)
      lines.push(parts.length ? `${name} (${parts.join(', ')})` : name)
    }
    if (lines.length === 0) return ''

    return `\n\n【중요 — 클라우드 가상 모델명 → 표준 모델 매핑】
클라우드사(NHN·NAVER·AWS 등)는 GPU를 자체 인스턴스/가상 이름으로 부릅니다(예: "g2", "GPU-A100-1", "vGPU 80G").
입력의 모델/인스턴스명이 표준과 다르면, 아래 보유 모델 카탈로그의 스펙(VRAM 용량·메모리타입·아키텍처·인터페이스)과 대조해
가장 일치하는 표준 model_name으로 매핑하세요. 예) "80GB HBM3 SXM" 단서 → H100. 매핑이 명확하지 않을 때만 원문 모델명을 유지하세요.

[보유 모델 카탈로그]
${lines.join(' | ')}`
  } catch {
    return ''
  }
}

// 입력에서 모든 URL 추출 (멀티 URL 지원 — P1/P4)
function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s]+/g)
  return matches ? Array.from(new Set(matches)) : []
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
- competitor_pricing: RunPod, Lambda Labs, AWS, CoreWeave, Vast.ai, NHN Cloud, NAVER Cloud, Azure, GCP, Runyour AI, SaladCloud, CloudV 등 경쟁 클라우드 서비스의 GPU 가격 정보
- supplier_quote: AX사업본부가 구매/공급받는 GPU 하드웨어/클라우드 자원 견적 (공급사로부터 받은 견적)

【최우선 — 사용자 지시 준수】
입력 텍스트에 사용자의 지시문(예: "월 금액이니 시간으로 변환", "8장 세트", "원화 표기" 등)이 있으면 반드시 그 지시를 먼저 따르세요. 사용자 지시가 아래 일반 규칙보다 우선합니다.

【중요 — 시간 단위 정규화 (price_usd는 반드시 "GPU 1장·1시간당 USD")】
가격이 시간당(/hr)이 아니면 반드시 시간당으로 환산하세요:
- 월(month/月/월/mo): ÷ 730    · 주(week): ÷ 168    · 일(day/日): ÷ 24    · 년(year/年): ÷ 8760
  예) $138.54/월 → price_usd: 0.19, notes: "원본: $138.54/월 (÷730 시간환산)"
- 여러 장(예: 8GPU 묶음 가격)이면 장수로 나눠 1장당으로. notes에 원본 기재.

【중요 — 통화 변환 규칙】
가격이 달러($, USD)가 아닌 다른 단위인 경우 반드시 USD로 변환하세요:
- KRW / 원 / ₩ / P(포인트) / C(크레딧): 1 USD = 1370 KRW 기준으로 나누어 USD 환산. notes 필드에 원본 가격 기재
  예) 3,615 C/hr → price_usd: 2.64, notes: "원본: 3,615 KRW/hr (1USD=1370KRW 기준 환산)"
- JPY / 円: 1 USD = 155 JPY 기준
- EUR / €: 1 EUR = 1.09 USD 기준
- 그 외 통화: 최신 환율 추정 적용, notes에 원본 기재
- 통화·시간 변환이 모두 필요하면 둘 다 적용(통화→USD 후 시간÷). notes에 원본 그대로 기재.

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
notes 필드: 통화·시간·장수 변환이 있을 때 원본을 기재(예: "원본: $138.54/월"), USD 시간당 직접 가격이면 생략 가능

supplier_quote이거나 GPU 가격이 아닌 경우:
{ "type": "supplier" }

JSON만 반환. 설명 없이.`


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

  // ── URL 감지 및 fetch (멀티 URL 병렬 + 원문 병합) ──────
  // P1: 모든 URL 처리 / P2: 원문(사용자 지시문)을 덮어쓰지 않고 URL 본문을 "추가" 병합
  const urls = imageBase64 ? [] : extractUrls(rawInputText)
  const sourceUrl = urls[0] ?? null
  let contentText = rawInputText

  if (urls.length > 0) {
    const fetchedBodies = await Promise.all(urls.map((u) => fetchUrlText(u)))
    const merged = fetchedBodies
      .map((body, i) => (body ? `\n\n[URL 본문 ${i + 1}: ${urls[i]}]\n${body}` : ''))
      .join('')
    // 원문(지시문 포함) 유지 + 가져온 URL 본문들을 뒤에 붙임. SPA 등으로 본문이 비어도 원문은 보존(PF1)
    if (merged) contentText = `${rawInputText}${merged}`
  }

  // 기존 보유 스펙 컨텍스트 — 모호한 모델명 추론용 (P3)
  const specContext = await loadSpecContext(adminClient)

  // ── AI 1단계: 입력 분류 (경쟁사 vs 공급가) ──────────
  if (!imageBase64) {
    const classifyPrompt = await getClassifyPrompt(adminClient)
    const classifyParts: Array<{ text: string }> = [
      { text: `${classifyPrompt}\n\n${SCHEMA_CONTRACT}${specContext}\n\n입력:\n${contentText}` },
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
          // ── 경쟁사 가격: 자동 저장하지 않고 "미리보기"만 반환 → 사용자가 '반영' 눌러야 저장
          return NextResponse.json({ type: 'competitor', preview: classified.items, count: classified.items.length, source_url: sourceUrl })
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

  const promptText = `${prompt.content}\n\n${SCHEMA_CONTRACT}${specContext}\n\n${contentText ? '입력 텍스트:\n' + contentText : '위 이미지에서 GPU 견적 정보를 추출하세요.'}`
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
  const rawItemsList: SingleExtracted[] = Array.isArray(parsed.items)
    ? parsed.items.slice(0, 50)
    : [{ extracted: parsed.extracted, confidence: parsed.confidence, evidence: parsed.evidence, impact_assessment: parsed.impact_assessment }]

  // 빈 추출 가드 — 모델명이 없는 항목은 GPU 견적이 아님(쓰레기 항목 생성 방지).
  // SPA URL 단독 등으로 본문에서 모델/가격을 못 찾은 경우 검토 대기에 빈 항목을 만들지 않고 안내. (PF1)
  const isMeaningful = (item: SingleExtracted): boolean => {
    const name = item.extracted?.model_name
    return typeof name === 'string' && name.trim().length > 0
  }
  const itemsList = rawItemsList.filter(isMeaningful)
  if (itemsList.length === 0) {
    const hadUrl = urls.length > 0
    return NextResponse.json({
      error: hadUrl
        ? 'URL 본문에서 GPU 모델·가격을 찾지 못했습니다. 페이지의 가격표 내용을 직접 붙여넣어 주세요.'
        : 'AI가 GPU 모델을 인식하지 못했습니다. 모델명·가격이 포함된 내용을 입력해 주세요.',
    }, { status: 422 })
  }

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
