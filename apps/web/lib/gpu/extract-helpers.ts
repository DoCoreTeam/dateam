// 통합입력 추출 공유 헬퍼 — 스트리밍 엔드포인트(stream/route.ts)에서 사용.
// 기존 review/route.ts의 인라인 헬퍼와 동일 로직(무수정 보존을 위해 별도 추출).
import type { createAdminClient } from '@/lib/supabase/server'
import { SCHEMA_CONTRACT } from '@/lib/gpu/schema-contract'
import { safeFetchText } from '@/lib/security/safe-fetch'
import { renderUrlHtml } from '@/lib/security/headless-fetch'
import { htmlToStructuredText } from '@/lib/gpu/html-table-extract'
import { DEFAULT_GEMINI_MODEL } from '../ai/gemini-model.ts'
import { callGeminiJson, callGeminiText, type GeminiPart } from '../ai/gemini-call.ts'

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * GPU 경로가 공용 호출부에 얹어 쓰는 선택지.
 *
 * 왜 생겼나(v0.7.678): 이 파일의 두 함수(`callGeminiOnce`·`callGeminiStream`)가
 * 자기 `fetch` 를 갖고 있었고 **타임아웃도 재시도도 모델 폴백도 없었다**.
 * 그래서 무료 티어 한도(모델당 하루 20회)에 걸린 날 GPU 통합입력·자동수집·카탈로그·
 * 업무 자동연결·프롬프트 편집이 **한꺼번에** 죽었다(실측 2026-09-02: HTTP 429 즉시 실패,
 * 같은 순간 `gemini-3.6-flash`·`3.7-flash`·`flash-lite-latest` 는 살아 있었다).
 *
 * 인자는 전부 선택이다 — 기존 호출부는 한 글자도 안 고쳐도 그대로 동작한다(M-4 추가 전용).
 */
export interface GpuGeminiOptions {
  /** Gemini 사슬이 전부 막혔을 때 쓸 두 번째 공급자 키. 이미지·PDF 가 있으면 자동으로 건너뛴다. */
  fallbackApiKey?: string
  /** 로그 라벨. */
  feature?: string
  /** 한 번의 호출 상한(ms). */
  timeoutMs?: number
  /** 재시도·모델 폴백을 전부 합친 상한(ms). */
  overallTimeoutMs?: number
  /** 모델을 갈아타거나 재시도할 때 — 화면에 "다른 모델로 다시 시도합니다"를 띄우기 위한 것. */
  onAttempt?: (info: { model: string; attempt: number }) => void
  /** 설정 모델이 아닌 모델로 처리했을 때 그 사실. 화면이 사용자에게 알릴 수 있게. */
  onNotice?: (notice: string) => void
}

// URL 본문 길이 상한 — 데이터 손실용(15K)이 아니라 보안/효율용 상한.
// 보안 상한(2MB)은 safe-fetch에서 유지. 여기선 AI 입력에 들어갈 구조화 텍스트 상한.
export const URL_BODY_MAX = 200_000

export async function getGeminiConfig(adminClient: ReturnType<typeof createAdminClient>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient as any)
    .from('org_content').select('value').eq('key', 'META').single()
  const meta = (data?.value as Record<string, unknown>) ?? {}
  return {
    apiKey: typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : '',
    model: typeof meta.gemini_model === 'string' ? meta.gemini_model : DEFAULT_GEMINI_MODEL,
    /**
     * Gemini 사슬이 전부 막혔을 때 쓰는 두 번째 공급자 키(Groq).
     * 조직이 이미 회의 녹음 STT에 쓰는 계정을 그대로 본다 — 새 키를 받지 않는다.
     * 없으면 빈 값이고, 그러면 폴백 없이 원래대로 실패한다(lib/ci/ai/meta.ts와 같은 규칙).
     */
    fallbackApiKey: typeof meta.groq_api_key === 'string' && meta.groq_api_key
      ? meta.groq_api_key
      : typeof meta.stt_api_key === 'string' ? meta.stt_api_key : '',
  }
}

export async function getExtractPrompt(adminClient: ReturnType<typeof createAdminClient>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient as any)
    .from('ai_prompts').select('content, version, model_hint')
    .eq('prompt_key', 'gpu.quote-extract').eq('active', true).single()
  return data as { content: string; version: string; model_hint: string } | null
}

export async function getClassifyPrompt(adminClient: ReturnType<typeof createAdminClient>, fallback: string): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (adminClient as any)
      .from('ai_prompts').select('content').eq('prompt_key', 'gpu.input-classify').eq('active', true).single()
    const c = data?.content
    return typeof c === 'string' && c.trim().length > 0 ? c : fallback
  } catch { return fallback }
}

export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s]+/g)
  return matches ? Array.from(new Set(matches)) : []
}

// URL 본문을 표 구조 보존 텍스트로 가져온다.
// 반환: { text, truncated } — truncated는 URL_BODY_MAX 초과로 잘렸는지(호출부가 사용자에게 고지).
// 일반 fetch가 빈손(JS 렌더 사이트의 빈 껍데기)인지 판단하는 임계 — 이 미만이면 헤드리스 렌더 폴백.
const URL_EMPTY_THRESHOLD = 300

export async function fetchUrlText(url: string): Promise<{ text: string; truncated: boolean }> {
  try {
    // SSRF 방어: safe-fetch SSOT 경유 (스킴·사설망·리다이렉트·크기 검증) — review/stream 경로 포함
    const res = await safeFetchText(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Accept': 'text/html,application/xhtml+xml' },
    })
    // R2: 태그 전체 제거(word-soup) 대신 <table> 행·열 보존 SSOT 파서 사용
    let structured = res.ok ? htmlToStructuredText(res.text) : ''

    // 하이브리드: 일반 fetch가 빈손/tiny면(=JS 렌더 사이트, 예 nebius) 헤드리스 Chromium으로 렌더 후 재파싱.
    // 렌더 실패/차단 시 renderUrlHtml은 '' 반환 → 기존 빈손 동작 유지(우아한 폴백, 회귀0).
    if (structured.trim().length < URL_EMPTY_THRESHOLD) {
      const rendered = await renderUrlHtml(url)
      if (rendered) {
        const renderedStructured = htmlToStructuredText(rendered)
        if (renderedStructured.trim().length > structured.trim().length) structured = renderedStructured
      }
    }

    if (!structured) return { text: '', truncated: false }
    const truncated = structured.length > URL_BODY_MAX
    return { text: truncated ? structured.slice(0, URL_BODY_MAX) : structured, truncated }
  } catch { return { text: '', truncated: false } }
}

// 보유 모델 카탈로그(스펙) — 가상 인스턴스명→표준모델 매핑 컨텍스트 (review/route.ts와 동일 로직)
export async function loadSpecContext(adminClient: ReturnType<typeof createAdminClient>): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = adminClient as any
    const [prodRes, specRes] = await Promise.all([
      db.from('gpu_products').select('model_name, memory').order('model_name', { ascending: true }).limit(300),
      db.from('gpu_specs').select('model_name, architecture, vram_gb, vram_type, interface').limit(300),
    ])
    const prods = (prodRes.data ?? []) as Array<{ model_name: string | null; memory: string | null }>
    const specs = (specRes.data ?? []) as Array<{ model_name: string | null; architecture: string | null; vram_gb: number | null; vram_type: string | null; interface: string | null }>
    const canonical = new Set<string>()
    for (const p of prods) { const n = (p.model_name ?? '').trim(); if (n) canonical.add(n) }
    if (canonical.size === 0) return ''
    const specByModel = new Map<string, { arch?: string; vram?: number; vramType?: string; iface?: string }>()
    for (const s of specs) {
      const n = (s.model_name ?? '').trim(); if (!n) continue
      specByModel.set(n, { arch: s.architecture ?? undefined, vram: s.vram_gb ?? undefined, vramType: s.vram_type ?? undefined, iface: s.interface ?? undefined })
    }
    const memByModel = new Map<string, Set<string>>()
    for (const p of prods) { const n = (p.model_name ?? '').trim(); if (!n) continue; if (p.memory) { if (!memByModel.has(n)) memByModel.set(n, new Set()); memByModel.get(n)!.add(p.memory) } }
    const lines: string[] = []
    for (const name of Array.from(canonical).sort()) {
      const sp = specByModel.get(name); const parts: string[] = []
      if (sp?.vram) parts.push(`VRAM ${sp.vram}GB${sp.vramType ? ' ' + sp.vramType : ''}`)
      else if (memByModel.get(name)?.size) parts.push(`VRAM ${Array.from(memByModel.get(name)!).join('/')}`)
      if (sp?.arch) parts.push(sp.arch); if (sp?.iface) parts.push(sp.iface)
      lines.push(parts.length ? `${name} (${parts.join(', ')})` : name)
    }
    if (lines.length === 0) return ''
    return `\n\n【중요 — 클라우드 가상 모델명 → 표준 모델 매핑】\n클라우드사(NHN·NAVER·AWS 등)는 GPU를 자체 인스턴스/가상 이름으로 부릅니다. 입력의 모델/인스턴스명이 표준과 다르면 아래 카탈로그의 스펙(VRAM·메모리타입·아키텍처·인터페이스)과 대조해 가장 일치하는 표준 model_name으로 매핑하세요.\n[보유 모델 카탈로그]\n${lines.join(' | ')}`
  } catch { return '' }
}

export { SCHEMA_CONTRACT }

// R1: DB 전체 스키마 자가인지 — get_schema_digest() RPC로 라이브 DB 구조(컬럼·enum·FK)를 런타임 파생.
// 메모리/정적계약서 의존 제거 — 새 컬럼·enum이 생기면 자동 반영. RPC 실패 시 정적 SCHEMA_CONTRACT 폴백.
export async function loadSchemaDigest(adminClient: ReturnType<typeof createAdminClient>): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (adminClient as any).rpc('get_schema_digest')
    if (error || typeof data !== 'string' || data.trim().length === 0) return SCHEMA_CONTRACT
    return `${SCHEMA_CONTRACT}\n\n【현재 DB 스키마 (런타임 자동 파생 — 이 구조에 정확히 맞춰 추출)】${data}`
  } catch {
    return SCHEMA_CONTRACT
  }
}

// 비스트리밍 Gemini 호출(합성용) — 단일 텍스트 반환.
export async function callGeminiOnce(
  apiKey: string, model: string, text: string, jsonMode = false, opts: GpuGeminiOptions = {},
): Promise<string> {
  // JSON 추출은 행 수가 많으면 기본 출력한도(8k)에 걸려 **뒷부분이 조용히 잘린다**
  //   (실사고 v0.7.363: verda 22관측 추출 시 V100·RTX PRO 6000 CC 행이 누락 — 완전성 게이트가 검출).
  //   공용부 기본값(32,768)이 그 상한을 이미 열어 두고, 닿으면 'truncated'로 말한다.
  const common = {
    prompt: text, apiKey, model,
    feature: opts.feature ?? 'gpu-intake',
    fallbackApiKey: opts.fallbackApiKey,
    timeoutMs: opts.timeoutMs,
    overallTimeoutMs: opts.overallTimeoutMs,
    onAttempt: opts.onAttempt,
  }
  if (jsonMode) {
    const r = await callGeminiJson({ ...common, temperature: 0 })
    if (r.fallbackNotice) opts.onNotice?.(r.fallbackNotice)
    // 호출부는 지금까지 이 반환값을 JSON.parse 해 왔다 — 계약을 그대로 지킨다.
    //   달라진 것은 산문에 섞여 온 JSON까지 건져낸다는 것뿐이다(recoverJson).
    return JSON.stringify(r.value)
  }
  const r = await callGeminiText({ ...common, temperature: 0.2, responseJson: false })
  if (r.fallbackNotice) opts.onNotice?.(r.fallbackNotice)
  return r.text
}

// 짧은 결정적 해시(Date/random 미사용) — 합성 프롬프트 키 생성용
export function shortHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36).slice(0, 8)
}

// R2/축6: 프롬프트 자가합성 — 미준비 입력에 맞는 추출 프롬프트를 AI가 생성 → 거버넌스 경유 자동반영(D3).
// eval 게이트(필수 필드 유지) 통과 시 즉시 active, 미통과 시 held. 모든 변경 감사·롤백 가능.
export async function synthesizeExtractPrompt(
  adminClient: ReturnType<typeof createAdminClient>,
  apiKey: string, model: string, sampleInput: string, schemaDigest: string,
): Promise<{ content: string; promptKey: string; activated: boolean } | null> {
  try {
    const meta = `당신은 데이터 추출 프롬프트를 설계하는 메타 AI입니다.
아래 [입력 샘플]은 기존 추출 프롬프트로는 GPU 가격 정보를 뽑지 못한 변칙 형식입니다.
[DB 스키마]에 정확히 맞춰 새로운 추출 프롬프트(한국어)를 작성하세요.
반드시 다음 JSON 필드명을 그대로 사용해 추출하도록 지시할 것: model_name, memory, unit_price_usd, supplier, term, 그리고 재고는 quantity 객체 안에 resp_qty.
출력은 {"items":[{"extracted":{...}}]} JSON 형식을 요구해야 합니다. 프롬프트 본문만 반환(설명·코드펜스 없이).

[DB 스키마]${schemaDigest}

[입력 샘플]
${sampleInput.slice(0, 4000)}`
    const content = (await callGeminiOnce(apiKey, model, meta, false)).trim()
    if (!content || content.length < 40) return null
    const promptKey = `gpu.auto-synth.${shortHash(sampleInput.slice(0, 200))}`
    const { autoActivatePrompt } = await import('./prompt-governance')
    const r = await autoActivatePrompt(adminClient as unknown as Record<string, unknown>, {
      promptKey, newContent: content,
      reason: '미준비 입력 형식 — 추출 0건으로 자가합성',
      trigger: 'empty_extraction', modelHint: model, nowIso: new Date().toISOString(),
    })
    return { content, promptKey, activated: r.activated }
  } catch {
    return null
  }
}

// Gemini 스트리밍 호출 — streamGenerateContent(SSE). 텍스트 델타를 onDelta로 흘림.
export async function callGeminiStream(
  apiKey: string, model: string,
  parts: GeminiPart[],
  onDelta: (text: string) => void,
  opts: GpuGeminiOptions = {},
): Promise<string> {
  // 폴백 공급자에게 넘길 텍스트 — parts 의 text 조각만 이어 붙인다.
  //   이미지·PDF 가 섞여 있으면 공용부가 알아서 폴백을 건너뛴다(그림을 못 보는 공급자라서).
  const promptText = parts.map((p) => p.text ?? '').filter(Boolean).join('\n\n')
  const r = await callGeminiJson({
    prompt: promptText,
    apiKey, model, parts, onDelta,
    temperature: 0,
    feature: opts.feature ?? 'gpu-intake',
    fallbackApiKey: opts.fallbackApiKey,
    timeoutMs: opts.timeoutMs,
    overallTimeoutMs: opts.overallTimeoutMs,
    onAttempt: opts.onAttempt,
  })
  if (r.fallbackNotice) opts.onNotice?.(r.fallbackNotice)
  // 호출부는 이 반환값을 JSON.parse 해 왔다 — 계약 유지. 공용부가 이미 복구·검증했으므로
  //   여기서 나가는 문자열은 항상 파싱 가능한 JSON 이다(산문만 낸 모델은 사슬에서 걸러졌다).
  return JSON.stringify(r.value)
}
