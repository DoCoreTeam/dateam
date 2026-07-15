// 목록 심층분석 v2 — 서버 오케스트레이터 드레인 SSOT.
// 스트림 라우트(app/api/admin/ai-chat/analyze/stream)와 크론 라우트(app/api/cron/analyze-drain)
// 양쪽이 이 모듈의 drainSession()만 호출한다 — 진행 로직은 여기 한 곳뿐(SSOT).
// 서버+DB가 실행주체, 브라우저는 관전자(.ralph/decisions/DECISION-20260715-orchestrator-protocol.md).
//
// 진행상태는 항상 count(status) 파생이다(deriveProgress) — 저장된 진행률 컬럼은 없다(하드코딩 금지).

import { getProviderConfig } from './registry.ts'
import { analyzeOneItem, synthesizeItems, type SynthItem } from './analyze-core.ts'
import { anchorItem } from './context-anchor.ts'
import { runWithConcurrency } from './concurrency.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

const DEFAULT_CONCURRENCY = 4
const STALL_MS = 10 * 60 * 1000 // claimed_at이 이보다 오래된 running 항목은 재claim 대상(워커 이탈 가정)
const CLAIM_CANDIDATE_MULTIPLIER = 3 // 조건부 갱신 경합 스킵 대비 여유 있게 후보 조회
const DIGEST_MAX_CHARS = 500
const RETRY_COUNT = 1
const RETRY_BACKOFF_MS = 800

export interface Progress {
  phase: string
  total: number
  pending: number
  running: number
  done: number
  error: number
  synthStatus: string
}

export interface DrainResult {
  drained: boolean
  progress: Progress
}

interface SessionRow {
  id: string
  command: string
  source_text: string
  control: 'running' | 'paused' | 'cancelled'
  phase: string
  synth_status: string
}

interface ItemRow {
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

async function readMeta(admin: AdminClient): Promise<Record<string, unknown>> {
  const { data } = await admin.from('org_content').select('value').eq('key', 'META').single()
  return (data?.value as Record<string, unknown>) ?? {}
}

/** META `ai_analysis_concurrency`(문자열/숫자 모두 허용) → 양의 정수, 미설정/무효 시 기본값. 순수 함수. */
export function concurrencyFromMeta(meta: Record<string, unknown>): number {
  const v = meta['ai_analysis_concurrency']
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CONCURRENCY
}

async function loadSession(admin: AdminClient, sessionId: string): Promise<SessionRow | null> {
  const { data } = await admin
    .from('ai_analysis_sessions')
    .select('id, command, source_text, control, phase, synth_status')
    .eq('id', sessionId)
    .is('deleted_at', null)
    .single()
  return (data as SessionRow | null) ?? null
}

/** 세션 진행 상태 — count(status) 파생 전용(저장값 아님). */
export async function deriveProgress(admin: AdminClient, sessionId: string): Promise<Progress> {
  const session = await loadSession(admin, sessionId)
  const { data: items } = await admin
    .from('ai_analysis_items')
    .select('status')
    .eq('session_id', sessionId)
  const rows = (items ?? []) as { status: string }[]

  return {
    phase: session?.phase ?? 'idle',
    total: rows.length,
    pending: rows.filter((r) => r.status === 'pending').length,
    running: rows.filter((r) => r.status === 'running').length,
    done: rows.filter((r) => r.status === 'done').length,
    error: rows.filter((r) => r.status === 'error').length,
    synthStatus: session?.synth_status ?? 'pending',
  }
}

/**
 * pending 또는 stalled(running & claimed_at < 10분전) 항목을 idx순 최대 limit개 조건부 claim.
 * 조회 후 `.eq('status', 기존status)` 조건부 update — affected 0(경합 패)이면 해당 후보는 스킵.
 */
async function claimItems(admin: AdminClient, sessionId: string, limit: number): Promise<ItemRow[]> {
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

interface RunItemCtx {
  apiKey: string
  model: string
  command: string
  sourceText: string
  signal: AbortSignal
  onDelta?: (itemIdx: number, delta: string) => void
}

/** 항목 1건 처리(맥락앵커 보강 → analyzeOneItem → done 영속). 실패 시 throw(runWithConcurrency 재시도용). */
async function runItem(
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
async function runSynthesis(
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

/**
 * 세션을 예산(deadlineMs) 내에서 드레인: claim → 동시성 처리 → (남은 항목 없으면) 취합 → done.
 * control='paused'면 신규 착수 중단(진행분 보존, drained:false), 'cancelled'면 즉시 종료(drained:true,
 * 완료분 보존). deadline 초과 시 drained:false(다음 크론/재-POST가 이어감).
 */
export async function drainSession(
  admin: AdminClient,
  sessionId: string,
  opts: {
    deadlineMs: number
    signal: AbortSignal
    onProgress?: (p: Progress) => void
    onDelta?: (itemIdx: number, delta: string) => void
  },
): Promise<DrainResult> {
  const startedAt = Date.now()
  const meta = await readMeta(admin)
  const geminiConfig = getProviderConfig(meta, 'gemini')
  const concurrency = concurrencyFromMeta(meta)

  const emitProgress = async (): Promise<void> => {
    if (!opts.onProgress) return
    opts.onProgress(await deriveProgress(admin, sessionId))
  }

  while (true) {
    if (opts.signal.aborted || Date.now() - startedAt > opts.deadlineMs) {
      return { drained: false, progress: await deriveProgress(admin, sessionId) }
    }

    const session = await loadSession(admin, sessionId)
    if (!session) {
      return { drained: true, progress: await deriveProgress(admin, sessionId) }
    }
    if (session.control === 'cancelled') {
      return { drained: true, progress: await deriveProgress(admin, sessionId) }
    }
    if (session.control === 'paused') {
      return { drained: false, progress: await deriveProgress(admin, sessionId) }
    }
    if (session.phase === 'idle') {
      await admin.from('ai_analysis_sessions').update({ phase: 'analyzing' }).eq('id', sessionId)
    }
    if (!geminiConfig) {
      // AI 프로바이더 미설정 — 진행 불가. 다음 크론 틱이 재확인.
      return { drained: false, progress: await deriveProgress(admin, sessionId) }
    }

    const claimed = await claimItems(admin, sessionId, concurrency)

    if (claimed.length === 0) {
      const progress = await deriveProgress(admin, sessionId)
      if (progress.total === 0) {
        return { drained: true, progress }
      }
      if (progress.pending === 0 && progress.running === 0) {
        if (progress.synthStatus === 'done' || progress.synthStatus === 'error') {
          return { drained: true, progress }
        }
        const drained = await runSynthesis(admin, sessionId, session, geminiConfig, opts.signal)
        return { drained, progress: await deriveProgress(admin, sessionId) }
      }
      // 다른 워커가 진행 중(아직 stall 아님) — 이번 틱에서 더 할 것 없음.
      return { drained: false, progress }
    }

    const results = await runWithConcurrency(
      claimed,
      concurrency,
      (item) =>
        runItem(
          admin,
          item,
          {
            apiKey: geminiConfig.apiKey,
            model: geminiConfig.model,
            command: session.command,
            sourceText: session.source_text,
            signal: opts.signal,
            onDelta: opts.onDelta,
          },
          emitProgress,
        ),
      { signal: opts.signal, retries: RETRY_COUNT, backoffMs: RETRY_BACKOFF_MS },
    )

    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (!r.ok) {
        await admin
          .from('ai_analysis_items')
          .update({ status: 'error', error_text: r.error.message, finished_at: new Date().toISOString() })
          .eq('id', claimed[i].id)
      }
    }
    await emitProgress()
  }
}
