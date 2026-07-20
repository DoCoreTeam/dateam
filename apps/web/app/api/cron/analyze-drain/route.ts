// 목록 심층분석 v2 — 크론 드레인 워커. 브라우저 이탈해도 진행이 이어지도록 매 1분(vercel.json)
// 미완 세션을 찾아 lib/ai-chat/analyze-runner.ts(drainSession, SSOT)를 이어서 호출한다.
// 무인증 컨텍스트(크론) — requireAdminApi 대신 Authorization: Bearer CRON_SECRET 검사.
// (.ralph/decisions/DECISION-20260715-cron-drain.md)

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { drainSession } from '@/lib/ai-chat/analyze-runner'

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

  return NextResponse.json({ ok: true, processed })
}
