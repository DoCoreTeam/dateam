// lib/ci/jobs/snapshot.ts — 지표 스냅샷 스케줄 실행 (설계서 §13)
// 간격 정책 SSOT는 snapshot-policy.ts다. 여기서는 DB에 반영하고 잡을 걸기만 한다.

import { createAdminClient } from '@/lib/supabase/server'
import { enqueueJob } from './queue.ts'
import { planNextCapture, type SnapshotPreset } from './snapshot-policy.ts'

// 호출처가 두 파일을 모두 알 필요는 없다.
export {
  snapshotIntervalSec, contentAgeHours, planNextCapture,
  SNAPSHOT_STOP_AFTER_DAYS, type SnapshotPreset, type SnapshotPlan,
} from './snapshot-policy.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 한 번의 tick에서 재수집을 걸 상한. 워커 배치(10건)보다 크면 큐만 불어난다. */
export const SNAPSHOT_DUE_MAX_PER_TICK = 10

/**
 * 수집이 끝난 콘텐츠의 다음 촬영을 예약한다.
 * 예약 실패가 수집을 실패로 만들지 않는다 — 스케줄은 보조 장치다.
 */
export async function scheduleSnapshot(input: {
  workspaceId: string
  contentId: string
  preset: SnapshotPreset
  publishedAt: string | null
  firstSeenAt: string
}): Promise<boolean> {
  try {
    const plan = planNextCapture(input)
    const adminClient = createAdminClient() as any

    if (!plan) {
      // 추적 종료 — 스케줄을 남겨두면 워커가 영원히 만료 행을 훑는다.
      await adminClient.from('ci_snapshot_schedules').delete().eq('content_id', input.contentId)
      return false
    }

    await adminClient.from('ci_snapshot_schedules').upsert({
      workspace_id: input.workspaceId,
      content_id: input.contentId,
      next_capture_at: plan.nextCaptureAt,
      interval_sec: plan.intervalSec,
      preset: input.preset,
      stop_after: plan.stopAfter,
    }, { onConflict: 'content_id' })

    return true
  } catch {
    return false
  }
}

export interface DueSweepResult {
  due: number
  enqueued: number
}

/**
 * 때가 된 스냅샷을 재수집 잡으로 건다.
 *
 * 멱등키가 `{stage}:{target}:{version}`이고 전역 유니크라, 같은 콘텐츠를 다시 수집하려면
 * 회차를 올려야 한다. 회차는 payload로 흘려 뒤따르는 단계(normalize…project)까지 함께 간다 —
 * 안 그러면 재수집은 되는데 파생값 재계산이 통째로 dedup에 걸려 조용히 사라진다.
 */
export async function runDueSnapshots(
  limit: number = SNAPSHOT_DUE_MAX_PER_TICK,
): Promise<DueSweepResult> {
  const adminClient = createAdminClient() as any
  const nowIso = new Date().toISOString()

  const { data: rows } = await adminClient
    .from('ci_snapshot_schedules')
    .select('content_id, workspace_id, interval_sec, preset, captures_done, stop_after')
    .lte('next_capture_at', nowIso)
    .or(`stop_after.is.null,stop_after.gt.${nowIso}`)
    .order('next_capture_at', { ascending: true })
    .limit(limit)

  const due = ((rows ?? []) as any[])
  if (due.length === 0) return { due: 0, enqueued: 0 }

  let enqueued = 0
  for (const row of due) {
    const round = Number(row.captures_done ?? 0) + 1
    const { jobId } = await enqueueJob({
      workspaceId: row.workspace_id,
      stage: 'ingest',
      targetType: 'content',
      targetId: row.content_id,
      payload: { snapshotRound: round },
      version: round + 1,          // 최초 수집이 version 1을 이미 썼다
    })
    if (jobId) enqueued += 1

    // 다음 촬영 시각은 지금 기준으로 민다. 잡이 밀려도 스케줄이 과거에 눌러앉지 않게.
    await adminClient.from('ci_snapshot_schedules').update({
      next_capture_at: new Date(Date.now() + Number(row.interval_sec) * 1000).toISOString(),
      captures_done: round,
    }).eq('content_id', row.content_id)
  }

  return { due: due.length, enqueued }
}
