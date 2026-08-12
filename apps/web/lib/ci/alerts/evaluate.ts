// lib/ci/alerts/evaluate.ts — 떡상 알림 재훑기 (설계서 §8.1)
//
// **왜 단건 트리거가 아니라 재훑기인가**
// 배수(outlier_index)는 채널 중앙값 대비라 **형제가 들어온 뒤에야 값이 선다**.
// 콘텐츠 하나가 적재되는 순간에만 알림 자격을 보면, 먼저 처리된 건은 비교군이 비어
// 그냥 지나가고 나중에 9배로 확정돼도 아무도 다시 보지 않는다.
// (크리에이티브 분석에서 실제로 그래서 9배 6건에 분석 0건이었다 — 같은 함정.)
// 파생값에 의존하는 후속 처리는 전부 재훑기로 짠다.

import { createAdminClient } from '@/lib/supabase/server'
import { resolveSettings, getResolved, type SettingRow } from '../settings/resolve.ts'
import { OUTLIER_MIN_BASELINE } from '../format/metrics.ts'
import { kstParts } from '@/lib/datetime/kst'
import {
  qualifiesForAlert, isQuietAt, alertTitle, alertBody,
  ALERT_MAX_PER_PASS, ALERT_LOOKBACK_DAYS,
  type QuietHours,
} from './rules.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AlertSweepResult {
  ok: boolean
  /** 이번 패스에서 새로 만든 알림 수(수신자 합계) */
  created: number
  /** 조용히 넘어간 이유 — 침묵 실패를 만들지 않기 위해 호출자에게 돌려준다 */
  skipped?: 'quiet_hours' | 'no_candidates' | 'no_members'
  errorCode?: string
  errorMessage?: string
  /** 무엇을 보고 그렇게 판단했는지. "0건"만 돌려주면 고장과 구분되지 않는다. */
  diagnostics?: {
    threshold: number
    /** 배수·비교군 조건을 통과한 수 */
    matched: number
    /** 그중 이미 알린 것을 뺀 수 */
    fresh: number
  }
}

/** 워크스페이스에 적용될 설정만 읽어 해석한다(개인 스코프는 잡에 없다). */
async function resolveWorkspaceSettings(workspaceId: string): Promise<Record<string, unknown>> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_settings')
    .select('scope, scope_id, key, value, is_encrypted, version')
    .or(`and(scope.eq.system,scope_id.is.null),and(scope.eq.workspace,scope_id.eq.${workspaceId})`)
  return resolveSettings((data ?? []) as SettingRow[], { userId: null, workspaceId })
}

/**
 * 기본 알림 룰을 보장한다.
 * 설계서 §10.1 "설정을 하나도 건드리지 않아도 제품이 완전히 동작" —
 * 사용자가 알림 룰을 만든 적이 없어도 떡상 알림은 켜져 있어야 한다.
 *
 * 룰 행이 반드시 있어야 하는 실무적 이유도 있다: 중복 알림을 막는 유니크 인덱스가
 * (rule_id, content_id, user_id)라서 rule_id가 null이면 dedup이 걸리지 않는다.
 */
async function ensureDefaultOutlierRule(
  workspaceId: string,
  threshold: number,
): Promise<{ id: string; threshold: number } | null> {
  const adminClient = createAdminClient() as any

  const { data: existing } = await adminClient
    .from('ci_alert_rules')
    .select('id, threshold, is_enabled')
    .eq('workspace_id', workspaceId)
    .eq('kind', 'outlier')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing) {
    if (!existing.is_enabled) return null            // 사용자가 껐다 — 존중한다
    return { id: existing.id, threshold: Number(existing.threshold) }
  }

  const { data: created } = await adminClient
    .from('ci_alert_rules')
    .insert({ workspace_id: workspaceId, kind: 'outlier', threshold })
    .select('id, threshold')
    .single()

  return created ? { id: created.id, threshold: Number(created.threshold) } : null
}

interface CandidateRow {
  content_id: string
  outlier_index: string | number | null
  outlier_baseline_n: number
  ci_contents: {
    title: string | null
    first_seen_at: string
    ci_channels: { display_name: string | null } | null
  } | null
}

/**
 * 워크스페이스의 떡상 후보를 훑어 알림을 만든다.
 *
 * 배달은 앱 안 알림함이다. push·email 발송 인프라는 아직 없고,
 * 없는 것을 있는 척 delivery_result에 적지 않는다.
 */
export async function runAlertBacklog(workspaceId: string): Promise<AlertSweepResult> {
  const adminClient = createAdminClient() as any

  const settings = await resolveWorkspaceSettings(workspaceId)
  const quiet = getResolved<QuietHours>(settings, 'alert.quiet_hours')
  const settingThreshold = getResolved<number>(settings, 'alert.outlier.threshold') ?? 3

  // 방해 금지 판정은 워크스페이스 시계(KST SSOT)로 한다.
  // 서버 로컬 시각으로 재면 배포 지역이 바뀌는 순간 조용해야 할 때 울린다.
  const nowParts = kstParts(new Date().toISOString())
  const nowHhmm = nowParts
    ? `${String(nowParts.hour).padStart(2, '0')}:${String(nowParts.minute).padStart(2, '0')}`
    : '12:00'
  if (isQuietAt(quiet, nowHhmm)) return { ok: true, created: 0, skipped: 'quiet_hours' }

  const rule = await ensureDefaultOutlierRule(workspaceId, settingThreshold)
  if (!rule) return { ok: true, created: 0, skipped: 'no_candidates' }

  // 룰의 배수가 기준이다. 설정은 룰이 없을 때의 초기값이고,
  // 룰이 생긴 뒤에는 룰이 진실 — 두 값을 매번 섞으면 어느 쪽이 이겼는지 아무도 모른다.
  const threshold = Number.isFinite(rule.threshold) ? rule.threshold : settingThreshold

  const sinceIso = new Date(Date.now() - ALERT_LOOKBACK_DAYS * 86_400_000).toISOString()

  const { data: rows, error } = await adminClient
    .from('ci_content_derived')
    .select(`
      content_id, outlier_index, outlier_baseline_n,
      ci_contents!inner (
        title, first_seen_at, workspace_id, deleted_at, is_stat_excluded,
        ci_channels ( display_name )
      )
    `)
    .eq('ci_contents.workspace_id', workspaceId)
    .is('ci_contents.deleted_at', null)
    .eq('ci_contents.is_stat_excluded', false)
    .gte('ci_contents.first_seen_at', sinceIso)
    .gte('outlier_index', threshold)
    .gte('outlier_baseline_n', OUTLIER_MIN_BASELINE)
    .order('outlier_index', { ascending: false })
    .limit(200)

  // 쿼리 오류를 삼키면 "후보 없음"과 구분이 안 된다.
  // 실제로 컬럼명 하나가 틀려 6건이 0건으로 조용히 보고됐다 — 침묵 실패는 금지다.
  if (error) {
    return { ok: false, created: 0, errorCode: 'QUERY_FAILED', errorMessage: error.message }
  }

  const candidates = ((rows ?? []) as CandidateRow[]).filter((r) =>
    qualifiesForAlert(
      {
        outlierIndex: r.outlier_index === null ? null : Number(r.outlier_index),
        baselineN: r.outlier_baseline_n,
        collectedAt: r.ci_contents?.first_seen_at ?? '',
      },
      threshold,
      OUTLIER_MIN_BASELINE,
    ),
  )
  const diagnostics = { threshold, matched: candidates.length, fresh: 0 }
  if (candidates.length === 0) return { ok: true, created: 0, skipped: 'no_candidates', diagnostics }

  const ids = candidates.map((r) => r.content_id)
  const { data: already } = await adminClient
    .from('ci_notifications')
    .select('content_id')
    .eq('rule_id', rule.id)
    .in('content_id', ids)
  const notified = new Set(((already ?? []) as { content_id: string }[]).map((r) => r.content_id))

  const pending = candidates.filter((r) => !notified.has(r.content_id)).slice(0, ALERT_MAX_PER_PASS)
  diagnostics.fresh = pending.length
  if (pending.length === 0) return { ok: true, created: 0, skipped: 'no_candidates', diagnostics }

  const { data: members } = await adminClient
    .from('ci_workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
  const userIds = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id)
  if (userIds.length === 0) return { ok: true, created: 0, skipped: 'no_members', diagnostics }

  const payload = pending.flatMap((r) => {
    const index = Number(r.outlier_index)
    const title = alertTitle(r.ci_contents?.ci_channels?.display_name ?? null, index)
    const body = alertBody(r.ci_contents?.title ?? null, r.outlier_baseline_n)
    return userIds.map((userId) => ({
      workspace_id: workspaceId,
      user_id: userId,
      rule_id: rule.id,
      content_id: r.content_id,
      title,
      body,
      deeplink: `/ci/trends?tab=outliers&content=${r.content_id}`,
      delivery_result: { inapp: 'sent' },
    }))
  })

  // 중복 방어는 위의 notified 선필터가 1차, DB 유니크 인덱스가 최종선이다.
  //
  // upsert(onConflict)를 쓰지 않는 이유: dedup 인덱스가 **부분 유니크**
  // (`where rule_id is not null and content_id is not null`)라 ON CONFLICT 대상으로 잡히지 않는다.
  // 그대로 두면 매 패스가 통째로 실패하면서 "알릴 게 없다"로 보고된다(실제로 그랬다).
  const { data: inserted, error: insertError } = await adminClient
    .from('ci_notifications').insert(payload).select('id')

  if (insertError) {
    // 유니크 위반(23505)은 동시 실행이 먼저 넣었다는 뜻 — 실패가 아니다.
    // 배치는 한 건만 충돌해도 통째로 죽으므로 한 줄씩 다시 넣어 나머지를 살린다.
    if (insertError.code !== '23505') {
      return {
        ok: false, created: 0, diagnostics,
        errorCode: 'INSERT_FAILED', errorMessage: insertError.message,
      }
    }
    let saved = 0
    for (const row of payload) {
      const { error } = await adminClient.from('ci_notifications').insert(row)
      if (!error) saved += 1
    }
    return { ok: true, created: saved, diagnostics }
  }

  return { ok: true, created: ((inserted ?? []) as unknown[]).length, diagnostics }
}
