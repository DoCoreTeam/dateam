// GET/POST /api/cron/system-log-prune — 오래된 시스템 로그를 지운다
//
// **왜 필요한가**: 로그는 무한 증식한다. 안 지우면 DB 가 먼저 죽고,
// 그러면 장애를 보려고 만든 것이 장애의 원인이 된다.
//
// 90일이 기준이다 — 그보다 오래된 실패는 이미 고쳤거나 다시 안 나는 것이고,
// 남겨 둬서 관리자가 얻는 것이 없다(`system_events` 는 도메인 진실이 아니다).
//
// **GET 과 POST 를 둘 다 연다.** Vercel 크론은 GET 으로 부른다 —
// POST 만 열어 뒀다가 8시간 내내 403 이 난 전례가 있다(v0.7.572).

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isMachineCall, machineAuthUnconfigured } from '@/lib/crm/jobs/machine-auth'

export const dynamic = 'force-dynamic'

/** 이보다 오래된 사건은 지운다 */
const RETENTION_DAYS = 90

async function prune(req: Request) {
  if (machineAuthUnconfigured()) {
    return NextResponse.json({ error: '크론 인증이 설정되지 않았습니다.' }, { status: 503 })
  }
  if (!isMachineCall(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = admin as any

  const { data, error } = await adm.from('system_events')
    .delete().lt('occurred_at', cutoff).select('id')
  if (error) {
    // 삼키지 않는다 — 조용히 실패하면 어느 날 갑자기 DB 가 가득 찬다
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  /**
   * 해결책은 **더는 참조하는 사건이 없을 때만** 지운다.
   * 지문이 살아 있는데 해결책만 지우면, 다음에 같은 오류가 났을 때 AI 를 또 부른다.
   */
  const { data: alive } = await adm.from('system_events').select('fingerprint')
  const keep = new Set(((alive ?? []) as { fingerprint: string }[]).map((r) => r.fingerprint))
  const { data: remedies } = await adm.from('system_event_remedies').select('fingerprint')
  const orphans = ((remedies ?? []) as { fingerprint: string }[])
    .map((r) => r.fingerprint).filter((f) => !keep.has(f))
  if (orphans.length > 0) {
    await adm.from('system_event_remedies').delete().in('fingerprint', orphans)
  }

  return NextResponse.json({
    ok: true,
    deletedEvents: (data ?? []).length,
    deletedRemedies: orphans.length,
    cutoff,
  })
}

export async function GET(req: Request) { return prune(req) }
export async function POST(req: Request) { return prune(req) }
