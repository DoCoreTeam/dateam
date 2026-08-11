// lib/ci/ai/creative-server.ts — 크리에이티브 분석 실행 (서버 전용)
// 썸네일 이미지를 Gemini에 함께 넘겨 "썸네일에 뭐라고 써 있는지"를 실제로 읽는다.

import { createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'
import { getGeminiMeta } from './meta.ts'
import {
  buildCreativePrompt, parseCreative, creativeFromRules, type CreativeAnalysis,
} from './creative.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const IMAGE_TIMEOUT_MS = 10_000
const MAX_IMAGE_BYTES = 4_000_000

async function fetchImageAsBase64(url: string): Promise<{ data: string; mime: string } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_IMAGE_BYTES) return null
    return {
      data: Buffer.from(buf).toString('base64'),
      mime: res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg',
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 썸네일과 제목을 함께 분석한다.
 * AI 키가 없거나 실패하면 규칙 기반 결과라도 남긴다 — 화면이 비지 않게.
 */
export async function analyzeCreative(contentId: string): Promise<{ ok: boolean; note?: string }> {
  const adminClient = createAdminClient() as any

  const { data: content } = await adminClient
    .from('ci_contents')
    .select('id, workspace_id, title, caption, thumbnail_url')
    .eq('id', contentId).maybeSingle()
  if (!content) return { ok: false, note: '콘텐츠를 찾을 수 없습니다' }

  const meta = await getGeminiMeta()
  let analysis: CreativeAnalysis = creativeFromRules(content.title)
  let model: string | null = null
  let note: string | undefined

  if (meta.geminiApiKey) {
    const image = content.thumbnail_url ? await fetchImageAsBase64(content.thumbnail_url) : null
    const prompt = buildCreativePrompt({
      title: content.title,
      caption: content.caption,
      hasThumbnail: Boolean(image),
    })

    const parts: Record<string, unknown>[] = [{ text: prompt }]
    if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.data } })

    try {
      const res = await fetch(
        `${API_BASE}/models/${encodeURIComponent(meta.geminiModel)}:generateContent?key=${meta.geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { temperature: 0.2 },
          }),
        },
      )
      if (res.ok) {
        const json = await res.json() as {
          candidates?: { content?: { parts?: { text?: string }[] } }[]
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
        }
        const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
        logTokenUsage({
          userId: null, feature: 'ci-verify', model: meta.geminiModel, provider: 'gemini',
          promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
          totalTokens: (json.usageMetadata?.promptTokenCount ?? 0) + (json.usageMetadata?.candidatesTokenCount ?? 0),
        })
        const parsed = parseCreative(text, content.title)
        if (parsed) {
          analysis = parsed
          model = meta.geminiModel
        } else {
          note = 'AI 응답 형식이 올바르지 않아 규칙 분석만 저장했습니다'
        }
      } else {
        note = `AI 호출 실패(${res.status}) — 규칙 분석만 저장했습니다`
      }
    } catch {
      note = 'AI를 호출하지 못해 규칙 분석만 저장했습니다'
    }
  } else {
    note = 'AI 키가 없어 제목 규칙만으로 분석했습니다'
  }

  await adminClient.from('ci_content_creative').upsert({
    content_id: contentId,
    workspace_id: content.workspace_id,
    thumbnail_text: analysis.thumbnailText,
    thumbnail_style: analysis.thumbnailStyle,
    thumbnail_summary: analysis.thumbnailSummary,
    hook_message: analysis.hookMessage,
    hook_type: analysis.hookType,
    title_pattern: analysis.titlePattern,
    evidence: {
      hasThumbnail: Boolean(content.thumbnail_url),
      source: model ? 'ai' : 'rules',
      note: note ?? null,
    },
    model,
    analyzed_at: new Date().toISOString(),
  }, { onConflict: 'content_id' })

  return { ok: true, note }
}
