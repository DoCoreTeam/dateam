// 통합입력 추출 공유 헬퍼 — 스트리밍 엔드포인트(stream/route.ts)에서 사용.
// 기존 review/route.ts의 인라인 헬퍼와 동일 로직(무수정 보존을 위해 별도 추출).
import type { createAdminClient } from '@/lib/supabase/server'
import { SCHEMA_CONTRACT } from '@/lib/gpu/schema-contract'
import { safeFetchText } from '@/lib/security/safe-fetch'
import { renderUrlHtml } from '@/lib/security/headless-fetch'
import { htmlToStructuredText } from '@/lib/gpu/html-table-extract'

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

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
    model: typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash',
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
  apiKey: string, model: string, text: string, jsonMode = false,
): Promise<string> {
  const res = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }], generationConfig: jsonMode ? { responseMimeType: 'application/json', temperature: 0 } : { temperature: 0.2 } }),
  })
  if (!res.ok) throw new Error(`gemini ${res.status}`)
  const j = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  return j.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
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
  parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }>,
  onDelta: (text: string) => void,
): Promise<string> {
  const url = `${GEMINI_API_BASE}/models/${model}:streamGenerateContent?alt=sse`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }),
  })
  if (!res.ok || !res.body) throw new Error(`gemini stream ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const j = JSON.parse(payload)
        const delta = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
        if (delta) { full += delta; onDelta(delta) }
      } catch { /* 부분 라인 무시 */ }
    }
  }
  return full
}
