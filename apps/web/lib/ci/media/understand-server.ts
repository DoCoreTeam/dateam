// lib/ci/media/understand-server.ts — 영상 실체 이해 실행 (서버 전용)
//
// 능력표(capability.ts)가 정한 방법대로 영상 또는 커버 이미지를 모델에 넘기고,
// 순수 모듈(understand.ts)이 만든 프롬프트로 물어 결과를 저장한다.
//
// 이 파일이 하는 판단은 하나뿐이다: **무엇으로 볼 것인가.**
// 무엇을 물을지(프롬프트)와 무엇을 받아들일지(파싱)는 순수 모듈에 있다 — 테스트가 닿게.

import { createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'
import { getGeminiMeta } from '../ai/meta.ts'
import { callGemini, type GeminiPart } from '../ai/gemini.ts'
import { resolveAccess, type MediaAccess } from './capability.ts'
import { isServiceFailure } from './policy.ts'
import {
  buildUnderstandPrompt, parseUnderstanding, hasUsableEvidence,
  EMPTY_UNDERSTANDING, type MediaUnderstanding,
} from './understand.ts'
import type { CiPlatform } from '../types.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 영상은 텍스트보다 오래 걸린다. 60초면 긴 영상에서 잘린다. */
const VIDEO_TIMEOUT_MS = 240_000
const IMAGE_TIMEOUT_MS = 30_000

/**
 * 출력 상한.
 * 대사 전문 + 화면 자막(실측 최대 59줄) + 구간 전개를 한 번에 받으면 기본값에서 잘린다
 * — 잘리면 JSON이 깨져 **전부** 버려진다(실측 21건 중 1건).
 */
const MAX_OUTPUT_TOKENS = 8192
const IMAGE_FETCH_TIMEOUT_MS = 10_000
const MAX_IMAGE_BYTES = 4_000_000

/**
 * 영상 실체를 읽는 데 쓰는 모델.
 *
 * 워크스페이스 기본 모델을 그대로 쓴다 — 키·모델 이중 관리는 회전 누락의 원인이다(ai/meta.ts).
 * 다만 원격 미디어는 **v1alpha 로만** 통과한다.
 * (실측 2026-08-18: v1beta + fileData → HTTP 404 빈 본문 / v1alpha → 200, VIDEO 4,997토큰)
 */
const MEDIA_API_VERSION = 'v1alpha' as const

async function fetchImageAsBase64(url: string): Promise<{ data: string; mime: string } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS)
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

export interface UnderstandResult {
  ok: boolean
  access: MediaAccess
  note?: string
  /**
   * 우리 쪽 문제로 실패했는가(쿼터·타임아웃·키 부재).
   * true면 이 회차를 멈춰야 한다 — 다음 건도 같은 이유로 실패한다.
   */
  serviceFailure?: boolean
}

/**
 * 게시물 하나의 영상 실체를 읽는다.
 *
 * 실패해도 **행은 남긴다** — 무엇으로 시도했고 왜 안 됐는지가 화면에 떠야
 * 사용자가 "고장인가 원래 안 되는 건가"를 구분할 수 있다.
 * (예전 화면은 아무 말 없이 비어 있었고, 그래서 "아무것도 못 하잖아"가 됐다)
 */
export async function understandMedia(contentId: string): Promise<UnderstandResult> {
  const adminClient = createAdminClient() as any

  const { data: content } = await adminClient
    .from('ci_contents')
    .select('id, workspace_id, platform, canonical_url, thumbnail_url, title, caption, duration_sec')
    .eq('id', contentId).maybeSingle()
  if (!content) return { ok: false, access: 'none', note: '콘텐츠를 찾을 수 없습니다' }

  // 몇 번째 시도인가. 행이 없으면 첫 시도다.
  const { data: prev } = await adminClient
    .from('ci_content_media').select('attempt_count').eq('content_id', contentId).maybeSingle()
  const attempt = ((prev?.attempt_count as number | null) ?? 0) + 1

  const decided = resolveAccess({
    platform: content.platform as CiPlatform,
    canonicalUrl: content.canonical_url ?? null,
    thumbnailUrl: content.thumbnail_url ?? null,
  })

  const meta = await getGeminiMeta()
  if (!meta.geminiApiKey) {
    await saveUnderstanding(contentId, content.workspace_id, EMPTY_UNDERSTANDING, {
      access: 'none', model: null, attempt, note: 'AI 키가 없어 영상을 분석하지 못했습니다',
    })
    return { ok: false, access: 'none', note: 'AI 키가 없어 영상을 분석하지 못했습니다', serviceFailure: true }
  }

  // ── 무엇으로 볼 것인가 ────────────────────────────────────────
  const parts: GeminiPart[] = []
  let hasVideo = false
  let hasImage = false

  if (decided.access === 'remote_video' && content.canonical_url) {
    parts.push({ kind: 'remote', uri: content.canonical_url })
    hasVideo = true
  } else if (decided.access === 'still_image' && content.thumbnail_url) {
    const img = await fetchImageAsBase64(content.thumbnail_url)
    if (img) {
      parts.push({ kind: 'inline', mimeType: img.mime, data: img.data })
      hasImage = true
    }
  }

  if (!hasVideo && !hasImage) {
    await saveUnderstanding(contentId, content.workspace_id, EMPTY_UNDERSTANDING, {
      access: 'none', model: null, attempt, note: decided.note,
    })
    return { ok: false, access: 'none', note: decided.note }
  }

  const prompt = buildUnderstandPrompt({
    hasVideo, hasImage,
    title: content.title ?? null,
    caption: content.caption ?? null,
    durationSec: content.duration_sec ?? null,
  })

  const res = await callGemini({
    apiKey: meta.geminiApiKey,
    model: meta.geminiModel,
    prompt,
    parts,
    apiVersion: MEDIA_API_VERSION,
    temperature: 0.2,
    timeoutMs: hasVideo ? VIDEO_TIMEOUT_MS : IMAGE_TIMEOUT_MS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  })

  const access: MediaAccess = hasVideo ? 'remote_video' : 'still_image'

  if (!res.ok) {
    await saveUnderstanding(contentId, content.workspace_id, EMPTY_UNDERSTANDING, {
      access, model: null, attempt, note: res.error,
    })
    return { ok: false, access, note: res.error, serviceFailure: isServiceFailure(res.error) }
  }

  logTokenUsage({
    userId: null, feature: 'ci-media', model: meta.geminiModel, provider: 'gemini',
    promptTokens: res.promptTokens, outputTokens: res.outputTokens,
    totalTokens: res.promptTokens + res.outputTokens,
  })

  const parsed = parseUnderstanding(res.text)
  if (!parsed) {
    await saveUnderstanding(contentId, content.workspace_id, EMPTY_UNDERSTANDING, {
      access, model: meta.geminiModel, attempt, note: 'AI 응답 형식이 올바르지 않았습니다',
    })
    return { ok: false, access, note: 'AI 응답 형식이 올바르지 않았습니다' }
  }

  const note = hasUsableEvidence(parsed)
    ? undefined
    : '영상을 읽었지만 말·자막·주제 근거를 찾지 못했습니다'

  await saveUnderstanding(contentId, content.workspace_id, parsed, {
    access, model: meta.geminiModel, attempt, note: note ?? null,
    promptTokens: res.promptTokens, outputTokens: res.outputTokens,
  })

  return { ok: true, access, note }
}

async function saveUnderstanding(
  contentId: string,
  workspaceId: string,
  u: MediaUnderstanding,
  ctx: {
    access: MediaAccess
    model: string | null
    note: string | null
    /** 이 시도가 몇 번째인가. 실패해도 행이 남으므로 이 값이 재시도 여부를 정한다 */
    attempt: number
    promptTokens?: number
    outputTokens?: number
  },
): Promise<void> {
  const adminClient = createAdminClient() as any
  await adminClient.from('ci_content_media').upsert({
    content_id: contentId,
    workspace_id: workspaceId,
    transcript: u.transcript,
    on_screen_text: u.onScreenText,
    beats: u.beats,
    hook_device: u.hookDevice,
    hook_message: u.hookMessage,
    ending: u.ending,
    cut_count: u.cutCount,
    pacing: u.pacing,
    shot_types: u.shotTypes,
    aspect: u.aspect,
    has_subtitle: u.hasSubtitle,
    subtitle_style: u.subtitleStyle,
    audio_style: u.audioStyle,
    setting: u.setting,
    people_count: u.peopleCount,
    topic_guess: u.topicGuess,
    topic_evidence: u.topicEvidence,
    why_it_works: u.whyItWorks,
    replicable_formula: u.replicableFormula,
    loopable: u.loopable,
    cta_present: u.ctaPresent,
    access_method: ctx.access,
    // 서비스 실패(쿼터·타임아웃)는 시도로 세지 않는다 — 영상에는 아무 문제가 없다.
    attempt_count: isServiceFailure(ctx.note) ? Math.max(0, ctx.attempt - 1) : ctx.attempt,
    // 성공하면 지운다 — 옛 실패 사유가 남아 화면이 거짓말하지 않게
    last_error: ctx.note,
    model: ctx.model,
    evidence: {
      note: ctx.note,
      promptTokens: ctx.promptTokens ?? null,
      outputTokens: ctx.outputTokens ?? null,
    },
    analyzed_at: new Date().toISOString(),
  }, { onConflict: 'content_id' })
}

/**
 * "읽지 않기로 했다"를 화면이 말할 수 있게 기록한다.
 *
 * 왜 필요한가: 기록이 없으면 화면은 "아직 읽지 않았습니다"라고 말한다. 그러면 사용자는
 * 기다리면 된다고 읽는다 — 실제로는 영원히 안 읽는데도.
 * (실측 2026-08-18: 41분짜리 롱폼이 길이 상한에 걸려 스킵됐는데 화면은 "아직"이라고 했다)
 *
 * 이미 기록이 있으면 건드리지 않는다 — 적재마다 같은 행을 다시 쓰는 것은 낭비다.
 */
export async function recordSkip(contentId: string, reason: string): Promise<void> {
  const adminClient = createAdminClient() as any
  const { data: content } = await adminClient
    .from('ci_contents').select('workspace_id').eq('id', contentId).maybeSingle()
  if (!content) return

  const { data: existing } = await adminClient
    .from('ci_content_media').select('content_id').eq('content_id', contentId).maybeSingle()
  if (existing) return

  await adminClient.from('ci_content_media').insert({
    content_id: contentId,
    workspace_id: content.workspace_id,
    access_method: 'none',
    // 시도한 적이 없다 — 시도해서 실패한 것과 구분해야 재시도 판정이 흐려지지 않는다
    attempt_count: 0,
    last_error: reason,
    evidence: { note: reason, skipped: true },
    analyzed_at: new Date().toISOString(),
  })
}
