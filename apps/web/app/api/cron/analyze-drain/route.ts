// 목록 심층분석 v2 — 크론 드레인 워커. 브라우저 이탈해도 진행이 이어지도록 매 1분(vercel.json)
// 미완 세션을 찾아 lib/ai-chat/analyze-runner.ts(drainSession, SSOT)를 이어서 호출한다.
// 무인증 컨텍스트(크론) — requireAdminApi 대신 Authorization: Bearer CRON_SECRET 검사.
// (.ralph/decisions/DECISION-20260715-cron-drain.md)

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { drainSession } from '@/lib/ai-chat/analyze-runner'
import { drainQueue } from '@/lib/ci/jobs/drain'
import { countPendingJobs, countStalledJobs } from '@/lib/ci/jobs/queue'
import { countDueSnapshots } from '@/lib/ci/jobs/snapshot'
import { countDueChannelSweeps } from '@/lib/ci/jobs/channel-sweep'
import {
  shouldRunBackstop, STALE_LOCK_MS, CRON_DRAIN_LIMIT, CRON_DRAIN_BUDGET_MS,
} from '@/lib/ci/jobs/drain-policy'

/** 상수시간 문자열 비교(타이밍 공격 방어, OWASP A07). 길이 불일치는 즉시 false. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export const runtime = 'nodejs'
export const maxDuration = 300

const DEADLINE_MS = 270_000
const MAX_SESSIONS_PER_TICK = 50
const STALL_MS = 10 * 60 * 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

interface ItemStatusRow {
  status: string
  claimed_at: string | null
  revision: number | null
}

interface ClaimableSessionRow {
  id: string
  synth_status: string
  grouping_revision: number | null
  ai_analysis_items: ItemStatusRow[] | null
}

/** control='running'이고 (pending 존재 OR stalled running 존재 OR 전항목 종료+synth 미완)인 세션만. */
async function findClaimableSessions(admin: AdminClient): Promise<{ id: string }[]> {
  const { data } = await admin
    .from('ai_analysis_sessions')
    .select('id, synth_status, grouping_revision, ai_analysis_items(status, claimed_at, revision)')
    .eq('control', 'running')
    .is('deleted_at', null)
    .limit(MAX_SESSIONS_PER_TICK)

  const rows = (data ?? []) as ClaimableSessionRow[]
  const stallThreshold = Date.now() - STALL_MS

  return rows
    .filter((r) => {
      // 현재 리비전만 — 구 리비전 pending이 남아 크론이 영원히 재드레인하는 것을 막는다
      const rev = r.grouping_revision ?? 1
      const items = (r.ai_analysis_items ?? []).filter((it) => (it.revision ?? 1) === rev)
      if (items.length === 0) return false

      const hasPending = items.some((i) => i.status === 'pending')
      const hasStalledRunning = items.some(
        (i) => i.status === 'running' && i.claimed_at !== null && new Date(i.claimed_at).getTime() < stallThreshold,
      )
      const allTerminal = items.every((i) => i.status === 'done' || i.status === 'error')
      const synthPending = allTerminal && (r.synth_status === 'pending' || r.synth_status === 'running')

      return hasPending || hasStalledRunning || synthPending
    })
    .map((r) => ({ id: r.id }))
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization') ?? ''
  if (!secret || !safeEqual(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const admin: AdminClient = createAdminClient()
  const sessions = await findClaimableSessions(admin)

  const processed: { sessionId: string; drained: boolean }[] = []
  for (const s of sessions) {
    try {
      const { drained } = await drainSession(admin, s.id, {
        deadlineMs: DEADLINE_MS,
        signal: req.signal,
      })
      processed.push({ sessionId: s.id, drained })
    } catch (err) {
      console.error('[cron/analyze-drain] session drain failed', s.id, err)
      processed.push({ sessionId: s.id, drained: false })
    }
  }

  // ── 콘텐츠 인텔리전스 백스톱 ────────────────────────────────────────
  // 주 경로는 브라우저(components/ci/QueueDriver)다. 여기는 **사람이 없는 시간**만 메운다.
  // 크론을 새로 추가하지 않는 이유: 이 크론이 이미 매분 돌고 있어서 여기에 얹으면 스케줄이 늘지 않는다.
  // 시간 게이트 대신 **할 일 유무**로 끊는다 — 일이 없으면 조회 3건으로 즉시 반환(사실상 0원),
  // 일이 있을 때만 처리한다. 시간으로 막으면 아낄 돈은 몇 푼인데 처리는 그만큼 늦어진다.
  // 브라우저가 동시에 돌고 있어도 잡 임대가 원자적이라 같은 잡을 두 번 실행하지 않는다.
  const ci = await runCiBackstop().catch((err) => {
    console.error('[cron/analyze-drain] ci backstop failed', err)
    return { skipped: 'error' as const }
  })

  return NextResponse.json({ ok: true, processed, ci })
}

/** 할 일이 있을 때만 CI 큐를 돌린다. 없으면 즉시 반환한다. */
async function runCiBackstop() {
  const [dueJobs, dueSnapshots, stalledJobs, dueSweeps] = await Promise.all([
    countPendingJobs(),
    countDueSnapshots(),
    countStalledJobs(STALE_LOCK_MS),
    countDueChannelSweeps(),
  ])

  if (!shouldRunBackstop({ dueJobs, dueSnapshots, stalledJobs, dueSweeps })) {
    return { skipped: 'idle' as const, dueJobs, dueSnapshots, stalledJobs, dueSweeps }
  }

  return drainQueue({
    limit: CRON_DRAIN_LIMIT,
    budgetMs: CRON_DRAIN_BUDGET_MS,
    workerPrefix: 'cron',
  })
}
