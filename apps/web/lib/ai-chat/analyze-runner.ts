// 목록 심층분석 v2 — 서버 오케스트레이터 드레인 SSOT.
// 스트림 라우트(app/api/admin/ai-chat/analyze/stream)와 크론 라우트(app/api/cron/analyze-drain)
// 양쪽이 이 모듈의 drainSession()만 호출한다 — 진행 로직은 여기 한 곳뿐(SSOT).
// 서버+DB가 실행주체, 브라우저는 관전자(.ralph/decisions/DECISION-20260715-orchestrator-protocol.md).
//
// 진행상태는 항상 count(status) 파생이다(deriveProgress) — 저장된 진행률 컬럼은 없다(하드코딩 금지).
// claim/항목처리/취합의 구현은 analyze-runner-worker.ts로 분리(300줄 제약 — 로직 경계는 그 파일 헤더 참고).
//
// control='cancelled' in-flight abort(§3 orchestrator-protocol): 배치(runWithConcurrency) 실행 중
// watchControlForAbort가 세션 control을 주기 폴링해 cancelled 감지 시 배치 전용 AbortController를
// abort() → analyzeOneItem/provider.streamChat까지 signal이 전파되어 진행 중인 스트림도 즉시 중단된다.
// 'paused'는 기존대로 신규 착수만 중단(진행 중인 항목은 완료 — 토큰 낭비 방지).

import { getProviderConfig } from './registry.ts'
import { runWithConcurrency } from './concurrency.ts'
import { claimItems, runItem, runSynthesis, type SessionRow, type ItemRow } from './analyze-runner-worker.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

const DEFAULT_CONCURRENCY = 4
const RETRY_COUNT = 1
const RETRY_BACKOFF_MS = 800
const CONTROL_POLL_MS = 1500 // in-flight cancel 감시 폴링 간격

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * control 폴링 감시 — getControl()이 'cancelled'를 반환하면 controller.abort()로 in-flight 배치를
 * 즉시 중단한다. controller가 이미 aborted면(배치 정상 종료 등) 루프를 스스로 끝낸다.
 * 순수 로직(주입 가능) — 단위테스트 대상. 실사용은 loadSession()을 getControl로 주입.
 */
export async function watchControlForAbort(
  getControl: () => Promise<string>,
  controller: AbortController,
  intervalMs: number,
): Promise<void> {
  while (!controller.signal.aborted) {
    const control = await getControl().catch(() => 'running')
    if (control === 'cancelled') {
      controller.abort()
      return
    }
    if (controller.signal.aborted) return
    await sleep(intervalMs)
  }
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

    // 배치 전용 AbortController — 외부 signal(opts.signal) abort는 여기로 전파하고,
    // watchControlForAbort가 세션 control='cancelled'를 감지하면 여기로 직접 abort()한다.
    const batchController = new AbortController()
    if (opts.signal.aborted) batchController.abort()
    const forwardAbort = (): void => batchController.abort()
    opts.signal.addEventListener('abort', forwardAbort)
    const watchPromise = watchControlForAbort(
      async () => {
        const s = await loadSession(admin, sessionId)
        return s?.control ?? 'running'
      },
      batchController,
      CONTROL_POLL_MS,
    ).catch(() => {})

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
            signal: batchController.signal,
            onDelta: opts.onDelta,
          },
          emitProgress,
        ),
      { signal: batchController.signal, retries: RETRY_COUNT, backoffMs: RETRY_BACKOFF_MS },
    )

    batchController.abort() // 배치 종료 — 감시 루프 정지(완료 후 abort는 안전한 no-op)
    opts.signal.removeEventListener('abort', forwardAbort)
    await watchPromise

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
