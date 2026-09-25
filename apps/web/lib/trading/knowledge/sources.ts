import 'server-only'

/**
 * 소스 분석 — 넣고 읽는 자리
 *
 * 판정은 `source-policy.ts`, 호출은 `ai-call.ts`. 여기는 왕복과 순서만 맡는다.
 *
 * **밖으로 나가는 요청은 `safeFetchText` 를 지난다**(S4). 주소를 사람이 주므로
 * 그대로 `fetch` 하면 사설망이나 클라우드 메타데이터 주소를 물린다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { safeFetchText } from '@/lib/security/safe-fetch'
import { callKnowledge } from './ai-call.ts'
import { applyAsOf } from './as-of.ts'
import {
  contentHash, normalizeSource, validateSource, parseAnalysis, keepGroundedFindings,
  isSourceRejection, buildSourcePrompt, MAX_RAW_LENGTH,
  type SourceInput, type SourceFinding,
} from './source-policy.ts'

export interface StoredSource {
  id: string
  kind: string
  ref: string
  summary: string | null
  findings: SourceFinding[]
  status: string
  reason: string | null
  availableAt: Date
}

interface RawSource {
  id: string
  source_kind: string
  source_ref: string
  summary: string | null
  findings: SourceFinding[] | null
  status: string
  reason: string | null
  available_at: string
}

/** 그 시각에 볼 수 있던 분석만 */
export async function sourcesAsOf(asOf: Date, limit = 50): Promise<StoredSource[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await applyAsOf(
    admin
      .from('trading_source_analyses')
      .select('id, source_kind, source_ref, summary, findings, status, reason, available_at')
      .order('available_at', { ascending: false })
      .limit(limit),
    asOf,
  )
  if (error) throw new Error(`소스 분석을 읽지 못했습니다: ${error.message}`)
  return ((data ?? []) as RawSource[]).map((r) => ({
    id: r.id,
    kind: r.source_kind,
    ref: r.source_ref,
    summary: r.summary,
    findings: Array.isArray(r.findings) ? r.findings : [],
    status: r.status,
    reason: r.reason,
    availableAt: new Date(r.available_at),
  }))
}

export type IngestResult =
  | { stored: true; id: string; hash: string }
  | { stored: false; reason: string; userMessage: string }

/**
 * 자료를 받아 **원문째로** 넣는다. 분석은 그 다음이다.
 *
 * 넣기와 분석을 한 걸음으로 묶지 않는다 — AI 가 죽은 날 자료까지 못 받게 되고,
 * 사람은 「넣었는데 사라졌다」를 본다.
 */
export async function ingestSource(input: SourceInput): Promise<IngestResult> {
  const { source } = normalizeSource(input)
  const rejection = validateSource(source)
  if (rejection) return { stored: false, ...rejection }

  const hash = contentHash(source.rawText)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('trading_source_analyses').insert({
    content_hash: hash,
    source_kind: source.kind,
    source_ref: source.ref,
    raw_text: source.rawText,
  }).select('id')

  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) {
      // 같은 글이다. 오류가 아니다 — 주소가 달라도 내용이 같으면 같은 자료다
      return { stored: false, reason: 'already_ingested', userMessage: '이미 넣은 자료입니다' }
    }
    return { stored: false, reason: `save_failed:${error.message}`.slice(0, 300), userMessage: '자료를 넣지 못했습니다' }
  }
  const id = (data ?? [])[0]?.id as string | undefined
  if (!id) return { stored: false, reason: 'no_id_returned', userMessage: '자료를 넣지 못했습니다' }
  return { stored: true, id, hash }
}

/** 주소에서 글을 받아 넣는다. **`safeFetchText` 를 지난다**(S4) */
export async function ingestUrl(url: string): Promise<IngestResult> {
  const fetched = await safeFetchText(url, { timeoutMs: 15_000 })
  if (!fetched.ok) {
    return {
      stored: false,
      reason: `fetch_failed:${fetched.blockedReason ?? fetched.status}`,
      userMessage: '그 주소에서 자료를 받지 못했습니다',
    }
  }
  // 태그를 벗겨 글만 남긴다. 화면에 넣을 때 사용자 HTML 이 그대로 들어가면 안 된다(S3·S4)
  const text = stripMarkup(fetched.text)
  return ingestSource({ kind: 'url', ref: url, rawText: text })
}

/**
 * 태그를 벗긴다. **원문 HTML 을 저장하지 않는다.**
 *
 * 남의 글을 그대로 담아 두면 화면 어딘가에서 한 번은 그대로 그려진다.
 * 여기서 평문으로 만들어 두면 그 길이 없다.
 */
export function stripMarkup(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_RAW_LENGTH)
}

export type AnalyzeResult =
  | { analyzed: true; kept: number; dropped: number }
  | { analyzed: false; reason: string; userMessage: string }

/** 아직 분석 안 한 자료 하나를 분석한다. 실패해도 원문은 남는다 */
export async function analyzeSource(id: string, model?: string | null): Promise<AnalyzeResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_source_analyses')
    .select('id, source_ref, raw_text, status')
    .eq('id', id)
    .limit(1)
  if (error) throw new Error(`자료를 읽지 못했습니다: ${error.message}`)
  const row = (data ?? [])[0] as { source_ref: string; raw_text: string; status: string } | undefined
  if (!row) return { analyzed: false, reason: 'not_found', userMessage: '자료를 찾을 수 없습니다' }
  if (row.status === 'done') {
    return { analyzed: false, reason: 'already_done', userMessage: '이미 분석한 자료입니다' }
  }

  const call = await callKnowledge({
    purpose: 'source_analysis',
    prompt: buildSourcePrompt(row.source_ref, row.raw_text),
    model,
    json: true,
    maxOutputTokens: 8192,
  })
  if (!call.ok) {
    await markFailed(id, call.reason, call.userMessage)
    return { analyzed: false, reason: call.reason, userMessage: call.userMessage }
  }

  let raw: unknown
  try {
    raw = JSON.parse(call.text)
  } catch {
    await markFailed(id, 'bad_json', 'AI 응답을 읽지 못했습니다')
    return { analyzed: false, reason: 'bad_json', userMessage: 'AI 응답을 읽지 못했습니다' }
  }

  const parsed = parseAnalysis(raw)
  if (isSourceRejection(parsed)) {
    await markFailed(id, parsed.reason, parsed.userMessage)
    return { analyzed: false, ...parsed }
  }

  // 인용이 원문에 없는 주장은 버린다. 버린 수는 남긴다
  const grounded = keepGroundedFindings(parsed, row.raw_text)
  const { error: updateError } = await admin.from('trading_source_analyses').update({
    summary: parsed.summary,
    findings: grounded.kept,
    status: 'done',
    reason: grounded.dropped > 0 ? `dropped_ungrounded:${grounded.dropped}` : null,
    user_message: null,
    model: call.model,
  }).eq('id', id)
  if (updateError) throw new Error(`분석을 적지 못했습니다: ${updateError.message}`)
  return { analyzed: true, kept: grounded.kept.length, dropped: grounded.dropped }
}

/** 실패해도 **원문은 그대로 남는다**. 사유가 남아야 다시 할지 사람이 정한다 */
async function markFailed(id: string, reason: string, userMessage: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_source_analyses').update({
    status: 'failed', reason: reason.slice(0, 300), user_message: userMessage,
  }).eq('id', id)
  if (error) throw new Error(`실패 사유를 적지 못했습니다: ${error.message}`)
}
