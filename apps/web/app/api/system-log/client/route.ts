// POST /api/system-log/client — 브라우저에서 난 렌더 오류를 관리자 로그로 옮긴다
//
// 왜 필요한가: 클라이언트에서 화면이 깨지면 **지금은 아무 데도 안 남는다.**
// 사용자는 흰 화면을 보고 그냥 나가고, 관리자는 그런 일이 있었다는 사실조차 모른다.
//
// 이 입구는 로그인한 사용자만 쓸 수 있고, 받은 값을 그대로 믿지 않는다 —
// 브라우저가 보내는 것은 전부 **사용자가 바꿀 수 있는 값**이다.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recordSystemEvent } from '@/lib/system-log/record'

/** 본문 상한 — 스택이 길어도 이보다 크면 받지 않는다(로그가 공격 통로가 되지 않게) */
const MAX_LEN = 4000

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // 익명 요청은 받지 않는다 — 밖에서 아무나 로그를 채워 넣을 수 있으면 로그를 못 믿는다
  if (!user) return NextResponse.json({ ok: false }, { status: 401 })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* 깨진 본문은 빈 것으로 본다 */ }

  const message = String(body.message ?? '').slice(0, MAX_LEN) || '화면을 그리는 중 오류가 발생했습니다'
  const stack = String(body.stack ?? '').slice(0, MAX_LEN)
  const route = String(body.route ?? '').slice(0, 300) || null

  const err = new Error(message)
  if (stack) err.stack = stack

  // 기다린다 — 어차피 화면은 이미 깨졌고, 이 기록이 마지막 단서다
  await recordSystemEvent({
    source: 'client', error: err, route, actorId: user.id, blocksUser: true,
    context: { digest: String(body.digest ?? '').slice(0, 100) || null },
  })

  return NextResponse.json({ ok: true })
}
