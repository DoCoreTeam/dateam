// 목록 심층분석 v2 — analyze-runner.ts(drainSession, SSOT)의 항목단위 워커 헬퍼.
// 300줄 분할 목적의 파일 분리이며 로직 경계: claim(원자적 조건부 갱신)·항목 1건 처리·취합 실행.
// 공개 API는 analyze-runner.ts만(drainSession) — 이 파일은 그 내부 구현.

import { analyzeOneItem, synthesizeItems, type SynthItem } from './analyze-core.ts'
import { anchorItem } from './context-anchor.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

const STALL_MS = 10 * 60 * 1000 // claimed_at이 이보다 오래된 running 항목은 재claim 대상(워커 이탈 가정)
const CLAIM_CANDIDATE_MULTIPLIER = 3 // 조건부 갱신 경합 스킵 대비 여유 있게 후보 조회
const DIGEST_MAX_CHARS = 500

export interface SessionRow {
  id: string
  command: string
  source_text: string
  control: 'running' | 'paused' | 'cancelled'
  phase: string
  synth_status: string
}

export interface ItemRow {
  id: string
  idx: number
  item_text: string
  status: string
  context_excerpt: string | null
  intent_note: string | null
  digest_text: string | null
}

interface ItemRowWithAttempts extends ItemRow {
  attempts: number
}

/**
 * pending 또는 stalled(running & claimed_at < 10분전) 항목을 idx순 최대 limit개 조건부 claim.
 * 조회 후 `.eq('status', 기존status)` 조건부 update — affected 0(경합 패)이면 해당 후보는 스킵.
 */
export async function claimItems(admin: AdminClient, sessionId: string, limit: number): Promise<ItemRow[]> {
  const stallThreshold = new Date(Date.now() - STALL_MS).toISOString()
  const { data: candidates } = await admin
    .from('ai_analysis_items')
    .select('id, idx, item_text, status, context_excerpt, intent_note, digest_text, attempts')
    .eq('session_id', sessionId)
    .or(`status.eq.pending,and(status.eq.running,claimed_at.lt.${stallThreshold})`)
    .order('idx', { ascending: true })
    .limit(limit * CLAIM_CANDIDATE_MULTIPLIER)

  const rows = (candidates ?? []) as ItemRowWithAttempts[]
  const claimed: ItemRow[] = []
  const nowIso = new Date().toISOString()

  for (const c of rows) {
    if (claimed.length >= limit) break
    const { data: updated, error } = await admin
      .from('ai_analysis_items')
      .update({ status: 'running', claimed_at: nowIso, started_at: nowIso, attempts: c.attempts + 1 })
      .eq('id', c.id)
      .eq('status', c.status) // 조건부 — 다른 워커가 먼저 claim했으면 affected 0
      .select('id, idx, item_text, status, context_excerpt, intent_note, digest_text')
    if (error || !updated || updated.length === 0) continue // 경합 패 — 스킵
    claimed.push(updated[0] as ItemRow)
  }
  return claimed
}

export interface RunItemCtx {
  apiKey: string
  model: string
  command: string
  sourceText: string
  signal: AbortSignal
  onDelta?: (itemIdx: number, delta: string) => void
}

/** 항목 1건 처리(맥락앵커 보강 → analyzeOneItem → done 영속). 실패 시 throw(runWithConcurrency 재시도용). */
export async function runItem(
  admin: AdminClient,
  item: ItemRow,
  ctx: RunItemCtx,
  emitProgress: () => Promise<void>,
): Promise<void> {
  let contextExcerpt = item.context_excerpt ?? undefined
  if (!contextExcerpt) {
    const anchored = anchorItem(ctx.sourceText, item.item_text)
    if (anchored) {
      contextExcerpt = anchored.excerpt
      await admin
        .from('ai_analysis_items')
        .update({ context_excerpt: contextExcerpt, span_start: anchored.start, span_end: anchored.end })
        .eq('id', item.id)
    }
  }

  const result = await analyzeOneItem({
    apiKey: ctx.apiKey,
    model: ctx.model,
    itemText: item.item_text,
    contextExcerpt,
    intentNote: item.intent_note ?? undefined,
    command: ctx.command,
    signal: ctx.signal,
    onDelta: (d) => ctx.onDelta?.(item.idx, d),
  })

  await admin
    .from('ai_analysis_items')
    .update({
      status: 'done',
      result_text: result.text,
      digest_text: result.text.slice(0, DIGEST_MAX_CHARS),
      finished_at: new Date().toISOString(),
      prompt_tokens: result.usage.promptTokens,
      output_tokens: result.usage.outputTokens,
    })
    .eq('id', item.id)

  await emitProgress()
}

/** 완료 항목 전부 취합(A3 SSOT synthesizeItems 재사용) → 세션에 영속. 반환값은 항상 true(취합 시도 완료). */
export async function runSynthesis(
  admin: AdminClient,
  sessionId: string,
  session: SessionRow,
  geminiConfig: { apiKey: string; model: string },
  signal: AbortSignal,
): Promise<boolean> {
  await admin
    .from('ai_analysis_sessions')
    .update({ phase: 'synthesizing', synth_status: 'running' })
    .eq('id', sessionId)

  const { data: doneItems } = await admin
    .from('ai_analysis_items')
    .select('idx, item_text, digest_text, result_text')
    .eq('session_id', sessionId)
    .eq('status', 'done')
    .order('idx', { ascending: true })

  const rows = (doneItems ?? []) as {
    idx: number
    item_text: string
    digest_text: string | null
    result_text: string | null
  }[]
  const items: SynthItem[] = rows.map((r) => ({
    idx: r.idx,
    itemText: r.item_text,
    digest: r.digest_text ?? (r.result_text ?? '').slice(0, DIGEST_MAX_CHARS),
  }))

  if (items.length === 0) {
    await admin
      .from('ai_analysis_sessions')
      .update({ phase: 'done', synth_status: 'error' })
      .eq('id', sessionId)
    return true
  }

  try {
    const result = await synthesizeItems({
      apiKey: geminiConfig.apiKey,
      model: geminiConfig.model,
      items,
      command: session.command,
      signal,
    })
    await admin
      .from('ai_analysis_sessions')
      .update({ phase: 'done', synth_status: 'done', synth_text: result.text, coverage: result.coverage })
      .eq('id', sessionId)
  } catch {
    await admin
      .from('ai_analysis_sessions')
      .update({ phase: 'done', synth_status: 'error' })
      .eq('id', sessionId)
  }
  return true
}
