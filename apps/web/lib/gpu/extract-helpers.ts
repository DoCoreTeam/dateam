// 통합입력 추출 공유 헬퍼 — 스트리밍 엔드포인트(stream/route.ts)에서 사용.
// 기존 review/route.ts의 인라인 헬퍼와 동일 로직(무수정 보존을 위해 별도 추출).
import type { createAdminClient } from '@/lib/supabase/server'
import { SCHEMA_CONTRACT } from '@/lib/gpu/schema-contract'

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

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

export async function fetchUrlText(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Accept': 'text/html,application/xhtml+xml' },
    })
    if (!res.ok) return ''
    const html = await res.text()
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '').replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 15000)
  } catch { return '' } finally { clearTimeout(timer) }
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
