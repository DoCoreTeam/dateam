import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { runAutolink } from '@/lib/work/autolink-run'

// 상수시간 토큰 비교(타이밍 사이드채널 차단): 길이 먼저 비교 후 timingSafeEqual.
function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

// autolink 사전계산 큐 워커 — 기계 호출 전용(사용자 세션 아님).
//   POST  Authorization: Bearer ${AUTOLINK_CRON_SECRET}
//   → pending 잡 최대 N개 선점(claim_autolink_jobs RPC, FOR UPDATE SKIP LOCKED)
//   → 각 잡 runAutolink(SSOT 재사용) → done / error 마킹
//   pg_cron + pg_net 이 분당 호출(mig107, 배포시 활성화).

const CLAIM_LIMIT = 5

interface ClaimedJob { id: string; log_id: string; requester_id: string }

export async function POST(req: NextRequest) {
  const secret = process.env.AUTOLINK_CRON_SECRET
  if (!secret) {
    console.error('[autolink-worker] AUTOLINK_CRON_SECRET 미설정')
    return NextResponse.json(
      { error: 'AUTOLINK_CRON_SECRET not configured' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  if (!safeEq(token, secret)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const noStore = { 'Cache-Control': 'no-store' }

  // 1) pending → processing 선점(동시성 안전: FOR UPDATE SKIP LOCKED RPC)
  const { data: claimed, error: claimErr } = await db.rpc('claim_autolink_jobs', { p_limit: CLAIM_LIMIT })
  if (claimErr) {
    console.error('[autolink-worker] claim 실패', claimErr)
    return NextResponse.json({ error: 'claim failed' }, { status: 500, headers: noStore })
  }

  const jobs: ClaimedJob[] = Array.isArray(claimed) ? claimed : []
  let done = 0
  let error = 0

  // 2) 각 잡 처리 — 개별 실패가 전체 중단을 막지 않도록 try/catch
  for (const job of jobs) {
    try {
      const result = await runAutolink(job.log_id, job.requester_id, job.requester_id)
      if (result.ok) {
        await db.from('autolink_jobs').update({ status: 'done', last_error: null, updated_at: new Date().toISOString() }).eq('id', job.id)
        done++
      } else {
        await db.from('autolink_jobs').update({ status: 'error', last_error: (result.error ?? 'unknown').slice(0, 500), updated_at: new Date().toISOString() }).eq('id', job.id)
        error++
      }
    } catch (e) {
      console.error('[autolink-worker] job 처리 실패', job.id, e)
      const msg = e instanceof Error ? e.message : String(e)
      try {
        await db.from('autolink_jobs').update({ status: 'error', last_error: msg.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', job.id)
      } catch (ue) {
        console.error('[autolink-worker] error 마킹 실패', job.id, ue)
      }
      error++
    }
  }

  return NextResponse.json({ processed: jobs.length, done, error }, { headers: noStore })
}
