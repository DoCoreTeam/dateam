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
import { buildStructureTree } from './grouping/structure-tree.ts'
import { serializeOutline } from './grouping/cut-groups.ts'
import { DOC_TYPES, type DocType } from './grouping/classify-doc.ts'
import { resolveTemplate } from './templates/resolve.ts'
import type { TemplateSpec } from './templates/catalog.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

// Gemini 분당 쿼터(RPM) 내성 — 50개+ 대량 항목에서 15개쯤부터 429가 터지던 사고 대응.
// 동시성을 낮춰 버스트를 줄이고, 429 재시도를 분당 창(≈60s)을 넘길 만큼 길게(2.5s→7.5s→22.5s→67.5s) 준다.
// 백그라운드 드레인(270s)+크론이 이어받으므로 긴 백오프가 전체 완료를 막지 않는다.
const DEFAULT_CONCURRENCY = 2
const RETRY_COUNT = 4
const RETRY_BACKOFF_MS = 2500
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

/**
 * 심화 실행 1회에 허용하는 최대 그룹 수(=AI 콜 수) — 비용 사고 방지 가드.
 *
 * 그룹핑 자체에는 상한을 두지 않는다(계약 B: "그룹 수는 결과값"). 상한을 두면 잘림 사고가 난다.
 * 대신 실제로 돈이 나가는 **심화 실행 단계에서만** 예산을 막고, 사용자에게
 * "더 크게 묶어서 다시 실행하라"고 안내한다 — 조용히 자르지 않는다.
 * META `ai_analysis_max_groups`로 조정 가능.
 */
const DEFAULT_MAX_GROUPS_PER_RUN = 300

export function maxGroupsFromMeta(meta: Record<string, unknown>): number {
  const v = meta['ai_analysis_max_groups']
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_GROUPS_PER_RUN
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
    .select('id, title, command, source_text, control, phase, synth_status, doc_type, grouping_revision')
    .eq('id', sessionId)
    .is('deleted_at', null)
    .single()
  return (data as SessionRow | null) ?? null
}

function isDocType(v: unknown): v is DocType {
  return typeof v === 'string' && (DOC_TYPES as readonly string[]).includes(v)
}

/** 세션 진행 상태 — count(status) 파생 전용(저장값 아님). */
export async function deriveProgress(admin: AdminClient, sessionId: string): Promise<Progress> {
  const session = await loadSession(admin, sessionId)
  // 현재 리비전만 센다 — 재그룹핑하면 이전 리비전 행이 남아 있어(히스토리 보존),
  // 필터하지 않으면 "완료 5 / 전체 8"처럼 구·신 리비전이 섞여 집계된다.
  const { data: items } = await admin
    .from('ai_analysis_items')
    .select('status')
    .eq('session_id', sessionId)
    .eq('revision', session?.grouping_revision ?? 1)
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
  const maxGroups = maxGroupsFromMeta(meta)

  // 비용 가드 — 그룹핑은 무제한이지만 AI 콜을 태우는 심화 실행은 예산을 넘지 않는다.
  // 자르지 않고 실행을 거부한다(유실 0 유지). 사용자는 더 크게 재그룹핑해서 다시 실행하면 된다.
  const progressBefore = await deriveProgress(admin, sessionId)
  if (progressBefore.total > maxGroups) {
    await admin
      .from('ai_analysis_sessions')
      .update({
        phase: 'error',
        synth_status: 'error',
        synth_error: `그룹이 ${progressBefore.total}개로 1회 실행 한도(${maxGroups}개)를 넘습니다. 더 크게 묶어서 다시 실행하세요.`,
      })
      .eq('id', sessionId)
    return { drained: true, progress: progressBefore }
  }

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

    const revision = session.grouping_revision ?? 1
    const claimed: ItemRow[] = await claimItems(admin, sessionId, revision, concurrency)

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

    // 배치당 1회 계산 — 그룹마다 다시 만들 필요 없는 순수 결정론 값(문서 구조·템플릿은 원문/명령 불변).
    const docType: DocType = isDocType(session.doc_type) ? session.doc_type : 'other'
    const docContext = serializeOutline(buildStructureTree(session.source_text))
    const template: Pick<TemplateSpec, 'name' | 'fields'> | undefined =
      resolveTemplate(session.command)?.template

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
            docType,
            docContext,
            template,
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
