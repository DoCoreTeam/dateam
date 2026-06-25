// 통합입력 관측 — 순수 record-builder/타입 SSOT. 부수효과·외부 import 없음(node:test 단위검증).
//  DB write 래퍼는 intake-telemetry.ts(이 모듈 + supabase import). 라우트는 telemetry.ts를 사용.

export type IntakeChannel = 'xlsx' | 'img' | 'pdf' | 'catalog' | 'own' | 'market_link' | 'text'
export type EventStatus = 'ok' | 'warn' | 'held' | 'dropped' | 'overwritten' | 'error'
export type RunStatus = 'running' | 'succeeded' | 'partial' | 'failed'

export type ReasonCode =
  | 'model_unresolved' | 'unparseable_price' | 'no_price_blocked' | 'slice_truncated'
  | 'key_mangled' | 'supplier_missing' | 'dup_merged'

export interface IntakeCounts {
  source_rows?: number; transcribed?: number; extracted?: number; resolved?: number
  held?: number; blocked?: number; confirmed?: number; truncated?: number
}

export interface RunInit {
  userId?: string | null
  channel: IntakeChannel
  sourceFilename?: string | null
  sourceMime?: string | null
  sourceBytes?: number | null
  rawInputHash?: string | null
  evidenceDriveFileId?: string | null
  rawGridDriveFileId?: string | null
  promptVersions?: Record<string, unknown>
  aiModels?: Record<string, unknown>
  isTest?: boolean
}

export interface EventInit {
  rowRef?: string | null
  stage: string
  status: EventStatus
  inputSnapshot?: unknown
  outputSnapshot?: unknown
  reasonCode?: ReasonCode | null
  reasonDetail?: string | null
}

/** run insert row 생성(snake_case DB 컬럼). 부수효과 없음. */
export function buildRunRow(init: RunInit): Record<string, unknown> {
  return {
    user_id: init.userId ?? null,
    channel: init.channel,
    source_filename: init.sourceFilename ?? null,
    source_mime: init.sourceMime ?? null,
    source_bytes: init.sourceBytes ?? null,
    raw_input_hash: init.rawInputHash ?? null,
    evidence_drive_file_id: init.evidenceDriveFileId ?? null,
    raw_grid_drive_file_id: init.rawGridDriveFileId ?? null,
    prompt_versions: init.promptVersions ?? {},
    ai_models: init.aiModels ?? {},
    status: 'running' as RunStatus,
    counts: {},
    is_test: init.isTest ?? false,
  }
}

/** event insert row 생성. 부수효과 없음. */
export function buildEventRow(runId: string, ev: EventInit): Record<string, unknown> {
  return {
    run_id: runId,
    row_ref: ev.rowRef ?? null,
    stage: ev.stage,
    status: ev.status,
    input_snapshot: ev.inputSnapshot ?? null,
    output_snapshot: ev.outputSnapshot ?? null,
    reason_code: ev.reasonCode ?? null,
    reason_detail: ev.reasonDetail ?? null,
  }
}

/** counts로 run 최종 상태 판정 — 손실(held/blocked/truncated)>0면 partial, error_code면 failed, 그 외 succeeded. */
export function deriveStatus(counts: IntakeCounts, errorCode?: string | null): RunStatus {
  if (errorCode) return 'failed'
  const lossy = (counts.held ?? 0) + (counts.blocked ?? 0) + (counts.truncated ?? 0)
  return lossy > 0 ? 'partial' : 'succeeded'
}

/** finishRun용 patch 생성. startedAtMs/nowMs는 호출부 주입(Date.now 비결정성 회피). */
export function finalizeRunPatch(
  counts: IntakeCounts,
  opts: { errorCode?: string | null; errorSummary?: string | null; startedAtMs: number; nowMs: number },
): Record<string, unknown> {
  return {
    status: deriveStatus(counts, opts.errorCode),
    counts,
    error_code: opts.errorCode ?? null,
    error_summary: opts.errorSummary ?? null,
    duration_ms: Math.max(0, opts.nowMs - opts.startedAtMs),
  }
}
