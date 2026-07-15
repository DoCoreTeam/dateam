// 목록 심층분석 v2 — 서버 오케스트레이터 드레인 SSOT.
// 스트림 라우트(app/api/admin/ai-chat/analyze/stream)와 크론 라우트(app/api/cron/analyze-drain)
// 양쪽이 이 모듈의 drainSession()만 호출한다 — 진행 로직은 여기 한 곳뿐(SSOT).
// 서버+DB가 실행주체, 브라우저는 관전자(.ralph/decisions/DECISION-20260715-orchestrator-protocol.md).
//
// 진행상태는 항상 count(status) 파생이다(deriveProgress) — 저장된 진행률 컬럼은 없다(하드코딩 금지).
// claim/항목처리/취합의 구현은 analyze-runner-worker.ts로 분리(300줄 제약 — 로직 경계는 그 파일 헤더 참고).

import { getProviderConfig } from './registry.ts'
import { runWithConcurrency } from './concurrency.ts'
import { claimItems, runItem, runSynthesis, type SessionRow, type ItemRow } from './analyze-runner-worker.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

const DEFAULT_CONCURRENCY = 4
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

    const claimed: ItemRow[] = await claimItems(admin, sessionId, concurrency)

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
