// 통합입력 관측(Observability) SSOT 발신기 — 모든 추출 경로(stream·commit·catalog)가 import해
//   run 시작/이벤트/종료를 단일 방식으로 적재한다. 라우트마다 insert 복붙 금지(SSOT).
// 비차단(fire-and-forget): 적재 실패가 추출 흐름을 절대 막지 않는다(token-logger 패턴).
// 적재는 service_role(createAdminClient) — RLS상 읽기는 admin 전용(PII 보호, 마이그 136).
//
// 순수 record-builder/타입은 intake-telemetry-core.ts(별칭 import 없음 → node:test 단위검증).
//   여기선 그걸 re-export + DB write 부수효과 래퍼만 둔다.

import { createAdminClient } from '@/lib/supabase/server'
import {
  buildRunRow, buildEventRow, finalizeRunPatch,
  type RunInit, type EventInit, type IntakeCounts,
} from './intake-telemetry-core'

export * from './intake-telemetry-core'

/** run 생성 → run id 반환(실패 시 null). 호출부는 null이면 이후 emit 생략. */
export async function startRun(init: RunInit): Promise<string | null> {
  try {
    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any).from('gpu_intake_runs').insert(buildRunRow(init)).select('id').single()
    if (error) return null
    return (data?.id as string) ?? null
  } catch { return null }
}

/** 이벤트 적재(fire-and-forget). runId 없으면 무동작. */
export function emitEvent(runId: string | null, ev: EventInit): void {
  if (!runId) return
  void (async () => {
    try {
      const admin = createAdminClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('gpu_intake_events').insert(buildEventRow(runId, ev))
    } catch { /* 비차단 */ }
  })()
}

/** run 종료 패치(fire-and-forget). nowMs 주입(테스트 결정성). */
export function finishRun(
  runId: string | null,
  counts: IntakeCounts,
  opts: { errorCode?: string | null; errorSummary?: string | null; startedAtMs: number; nowMs: number },
): void {
  if (!runId) return
  void (async () => {
    try {
      const admin = createAdminClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('gpu_intake_runs').update({ ...finalizeRunPatch(counts, opts), finished_at: new Date(opts.nowMs).toISOString() }).eq('id', runId)
    } catch { /* 비차단 */ }
  })()
}
