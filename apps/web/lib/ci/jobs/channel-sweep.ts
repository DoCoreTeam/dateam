// lib/ci/jobs/channel-sweep.ts — 지켜보는 계정을 주기적으로 다시 훑는다
//
// 왜 필요한가: 채널을 "지켜보기"로 등록하면 사용자는 **앞으로 올라올 것도 본다**고 이해한다.
// 그런데 지금까지 훑기는 등록 시점 한 번뿐이었다 — 그 뒤로 그 계정에 뭘 올리든
// 시스템은 영원히 몰랐다. 모니터링이라는 이름만 있고 동작이 없었다.
//
// 주기는 `ingest.refresh_interval_hours`(기본 24시간)가 정한다. 그 설정은
// 화면에 노출돼 있었는데 **읽는 코드가 한 줄도 없었다** — 사용자가 바꿔도 아무 일이 없었다.
//
// 훑기 자체는 채널 잡이 한다. 여기서는 "지금 훑을 때가 된 채널"만 골라 잡을 건다.

import { createAdminClient } from '@/lib/supabase/server'
import { enqueueJob } from './queue.ts'
import { resolveSettings, getResolved, type SettingRow } from '../settings/resolve.ts'
import {
  isSweepDue, normalizeIntervalHours,
  SWEEP_DUE_MAX_PER_TICK, DEFAULT_REFRESH_INTERVAL_HOURS,
  type DueSweepResult,
} from './channel-sweep-policy.ts'

// 정책은 순수 모듈이 갖는다. 호출부가 두 곳을 import하지 않도록 여기서 다시 내보낸다.
export {
  isSweepDue, normalizeIntervalHours,
  SWEEP_DUE_MAX_PER_TICK, DEFAULT_REFRESH_INTERVAL_HOURS,
}
export type { DueSweepResult }

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 이 워크스페이스의 재훑기 주기.
 *
 * `ci_settings`는 scope/scope_id 구조라 행을 직접 읽으면 우선순위(개인>워크스페이스>시스템)를
 * 잘못 적용하기 쉽다. 해석은 `resolveSettings` SSOT에 맡기고 여기서는 값만 받는다.
 */
async function loadIntervalHours(workspaceId: string): Promise<number> {
  try {
    const adminClient = createAdminClient() as any
    const { data } = await adminClient
      .from('ci_settings').select('scope, scope_id, key, value, is_encrypted, version')
      .eq('key', 'ingest.refresh_interval_hours')
    const resolved = resolveSettings((data ?? []) as SettingRow[], { userId: null, workspaceId })
    return normalizeIntervalHours(getResolved<number>(resolved, 'ingest.refresh_interval_hours'))
  } catch {
    return DEFAULT_REFRESH_INTERVAL_HOURS
  }
}

/**
 * 훑을 때가 된 관심 채널에 재훑기 잡을 건다.
 *
 * `last_sweep_at`을 **거는 시점에** 찍는다 — 잡이 끝나기를 기다리면 그 사이 다음 틱이
 * 같은 채널에 또 걸어 같은 계정을 여러 번 훑는다(외부 API 쿼터 낭비).
 */
export async function runDueChannelSweeps(
  limit: number = SWEEP_DUE_MAX_PER_TICK,
  workspaceId?: string | null,
): Promise<DueSweepResult> {
  const adminClient = createAdminClient() as any

  let query = adminClient
    .from('ci_channels')
    .select('id, workspace_id, last_sweep_at')
    .eq('is_monitored', true)
    .is('deleted_at', null)
  if (workspaceId) query = query.eq('workspace_id', workspaceId)

  // 오래 안 훑은 것부터. nullsFirst — 한 번도 안 훑은 채널이 가장 급하다.
  const { data: rows } = await query
    .order('last_sweep_at', { ascending: true, nullsFirst: true })
    .limit(limit * 4)

  const channels = ((rows ?? []) as any[])
  if (channels.length === 0) return { due: 0, enqueued: 0 }

  // 주기는 워크스페이스마다 다르다. 같은 워크스페이스를 여러 번 조회하지 않는다.
  const intervalByWs = new Map<string, number>()
  const now = Date.now()
  const due: any[] = []

  for (const ch of channels) {
    if (due.length >= limit) break
    let hours = intervalByWs.get(ch.workspace_id)
    if (hours === undefined) {
      hours = await loadIntervalHours(ch.workspace_id)
      intervalByWs.set(ch.workspace_id, hours)
    }
    if (isSweepDue(ch.last_sweep_at, hours, now)) due.push(ch)
  }

  if (due.length === 0) return { due: 0, enqueued: 0 }

  let enqueued = 0
  const nowIso = new Date(now).toISOString()

  for (const ch of due) {
    // 먼저 찍고 건다 — 중복 훑기 방지(위 주석 참고)
    await adminClient.from('ci_channels')
      .update({ last_sweep_at: nowIso })
      .eq('id', ch.id)

    const { jobId } = await enqueueJob({
      workspaceId: ch.workspace_id,
      stage: 'ingest',
      targetType: 'channel',
      targetId: ch.id,
      // 버전을 시각으로 둔다 — 매 주기가 별개의 잡이어야 멱등키에 먹히지 않는다
      version: now,
    })
    if (jobId) enqueued += 1
  }

  return { due: due.length, enqueued }
}

/** 지금 훑을 때가 된 채널 수 — 크론 백스톱의 게이트용(처리는 하지 않는다). */
export async function countDueChannelSweeps(workspaceId?: string | null): Promise<number> {
  try {
    const r = await peekDue(workspaceId)
    return r
  } catch {
    return 0
  }
}

async function peekDue(workspaceId?: string | null): Promise<number> {
  const adminClient = createAdminClient() as any
  let query = adminClient
    .from('ci_channels')
    .select('workspace_id, last_sweep_at')
    .eq('is_monitored', true)
    .is('deleted_at', null)
  if (workspaceId) query = query.eq('workspace_id', workspaceId)

  const { data } = await query.limit(200)
  const rows = ((data ?? []) as any[])
  if (rows.length === 0) return 0

  const intervalByWs = new Map<string, number>()
  const now = Date.now()
  let n = 0
  for (const ch of rows) {
    let hours = intervalByWs.get(ch.workspace_id)
    if (hours === undefined) {
      hours = await loadIntervalHours(ch.workspace_id)
      intervalByWs.set(ch.workspace_id, hours)
    }
    if (isSweepDue(ch.last_sweep_at, hours, now)) n += 1
  }
  return n
}
