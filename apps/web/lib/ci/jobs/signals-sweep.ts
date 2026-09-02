// lib/ci/jobs/signals-sweep.ts — 이슈를 주기적으로 다시 훑는다
//
// **왜 새 스케줄러를 안 만드나**: 5분마다 도는 크론(`/api/cron/analyze-drain`)이 이미
// CI 큐를 비우고 채널 재훑기·지표 촬영까지 예약한다. 여기에 한 줄을 더하면
// 이슈 수집도 같은 길로 돈다 — 새 크론을 만들면 인증·예산·백오프를 또 짜게 된다.
//
// 여기서는 **잡을 걸기만** 한다. 실제 웹 검색은 잡 핸들러가 한다(재시도·DLQ를 큐가 준다).

import { createAdminClient } from '@/lib/supabase/server'
import { enqueueJob } from './queue.ts'
import { isQuotaMessage, isUnsupportedStageMessage } from '../analysis/signals.ts'
import { resolveSettings, getResolved, type SettingRow } from '../settings/resolve.ts'
import {
  isSignalSweepDue, normalizeSignalIntervalHours, effectiveSignalIntervalHours,
  SIGNAL_SWEEP_MAX_PER_TICK, DEFAULT_SIGNAL_INTERVAL_HOURS,
  type DueSignalSweepResult,
} from './signals-sweep-policy.ts'

// 정책은 순수 모듈이 갖는다. 호출부가 두 곳을 import 하지 않도록 여기서 다시 내보낸다.
export {
  isSignalSweepDue, normalizeSignalIntervalHours,
  SIGNAL_SWEEP_MAX_PER_TICK, DEFAULT_SIGNAL_INTERVAL_HOURS,
}
export type { DueSignalSweepResult }

/* eslint-disable @typescript-eslint/no-explicit-any */

interface WsRow { id: string; last_signal_sweep_at: string | null }

async function loadWorkspaceSettings(
  workspaceId: string,
): Promise<{ enabled: boolean; intervalHours: number }> {
  try {
    const adminClient = createAdminClient() as any
    const { data } = await adminClient
      .from('ci_settings').select('scope, scope_id, key, value, is_encrypted, version')
      .in('key', ['signals.enabled', 'signals.interval_hours'])
    const resolved = resolveSettings((data ?? []) as SettingRow[], { userId: null, workspaceId })
    return {
      enabled: getResolved<boolean>(resolved, 'signals.enabled') !== false,
      intervalHours: normalizeSignalIntervalHours(
        getResolved<number>(resolved, 'signals.interval_hours'),
      ),
    }
  } catch {
    return { enabled: true, intervalHours: DEFAULT_SIGNAL_INTERVAL_HOURS }
  }
}

async function pickDue(workspaceId?: string | null, limit = SIGNAL_SWEEP_MAX_PER_TICK): Promise<WsRow[]> {
  const adminClient = createAdminClient() as any
  let query = adminClient
    .from('ci_workspaces')
    .select('id, last_signal_sweep_at')
    .is('deleted_at', null)
  if (workspaceId) query = query.eq('id', workspaceId)

  // 오래 안 훑은 것부터. nullsFirst — 한 번도 안 훑은 워크스페이스가 가장 급하다.
  const { data } = await query
    .order('last_signal_sweep_at', { ascending: true, nullsFirst: true })
    .limit(Math.max(limit * 4, 8))

  const rows = ((data ?? []) as WsRow[])
  const now = Date.now()
  const due: WsRow[] = []
  for (const ws of rows) {
    if (due.length >= limit) break
    const s = await loadWorkspaceSettings(ws.id)
    if (!s.enabled) continue
    // 한도에 막혀 있으면 짧은 주기로 찔러본다 — 구글이 복구 시각을 안 알려주므로
    // 정상 주기로 기다리면 이미 풀린 한도를 최대 12시간 모르고 지나간다
    const blocked = await lastFailedByQuota(ws.id)
    const hours = effectiveSignalIntervalHours(s.intervalHours, blocked)
    if (isSignalSweepDue(ws.last_signal_sweep_at, hours, now)) due.push(ws)
  }
  return due
}

/**
 * 마지막 이슈 수집이 **한도** 때문에 실패했나.
 *
 * 다른 실패(네트워크·파싱)와 구분하는 이유: 한도는 시간이 지나면 저절로 풀리므로
 * 자주 찔러보는 것이 맞지만, 그 외 실패는 자주 반복해도 같은 결과라 한도만 태운다.
 */
async function lastFailedByQuota(workspaceId: string): Promise<boolean> {
  try {
    const adminClient = createAdminClient() as any
    const { data } = await adminClient
      .from('ci_jobs').select('status, error_message')
      .eq('workspace_id', workspaceId).eq('stage', 'signals')
      .order('created_at', { ascending: false }).limit(5)
    // 배포본이 남긴 «모르는 단계» 기록은 건너뛴다 — 그게 앞에 서면 진짜 원인이 가려져
    // 한도로 막힌 상태인데도 짧은 재시도가 꺼진다(화면 판정과 같은 규칙, 실측 2026-09-02)
    const rows = (data ?? []) as { status?: string; error_message?: string | null }[]
    const last = rows.find((r) => !isUnsupportedStageMessage(r.error_message))
    if (!last || (last.status !== 'failed' && last.status !== 'dead')) return false
    return isQuotaMessage(last.error_message)
  } catch {
    return false
  }
}

/**
 * 훑을 때가 된 워크스페이스에 이슈 수집 잡을 건다.
 *
 * `last_signal_sweep_at` 을 **거는 시점에** 찍는다 — 잡이 끝나기를 기다리면
 * 그 사이 다음 틱이 같은 워크스페이스에 또 걸어 웹 검색 한도를 두 배로 태운다
 * (채널 재훑기에서 겪은 것과 같은 함정).
 */
export async function runDueSignalSweeps(
  limit: number = SIGNAL_SWEEP_MAX_PER_TICK,
  workspaceId?: string | null,
): Promise<DueSignalSweepResult> {
  const due = await pickDue(workspaceId, limit)
  if (due.length === 0) return { due: 0, enqueued: 0 }

  const adminClient = createAdminClient() as any
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  let enqueued = 0

  for (const ws of due) {
    // 먼저 찍고 건다 — 중복 훑기 방지(위 주석 참고)
    await adminClient.from('ci_workspaces')
      .update({ last_signal_sweep_at: nowIso })
      .eq('id', ws.id)

    const { jobId } = await enqueueJob({
      workspaceId: ws.id,
      stage: 'signals',
      targetType: 'workspace',
      targetId: ws.id,
      // 버전을 시각으로 둔다 — 매 주기가 별개의 잡이어야 멱등키에 먹히지 않는다
      version: now,
    })
    if (jobId) enqueued += 1
  }
  return { due: due.length, enqueued }
}

/** 지금 훑을 때가 된 워크스페이스 수 — 크론 백스톱의 게이트용(처리는 하지 않는다). */
export async function countDueSignalSweeps(workspaceId?: string | null): Promise<number> {
  try {
    return (await pickDue(workspaceId, SIGNAL_SWEEP_MAX_PER_TICK)).length
  } catch {
    return 0
  }
}
