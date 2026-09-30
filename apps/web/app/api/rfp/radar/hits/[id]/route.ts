// PATCH /api/rfp/radar/hits/:id — 적중 한 건의 상태를 바꾼다
//
// 「상관없는 공고를 뺀다」가 여기로 온다. 지우지 않고 **상태만 바꾼다** —
// 원천(rfp_sources)은 그대로 두고 적중만 뺀다. 원천을 지우면 다음 훑기에 또 들어오고,
// 그러면 사용자는 뺀 것이 되살아나는 것을 본다.
//
// ## 권한 판정을 표에 맡긴다
//
// 창구는 로그인만 확인한다. 「이 조직 것을 바꿔도 되나」는 표 정책
// (rfp_radar_hits_update = rfp_can_write(org_id))이 판정한다. 창구에서 또 판정하면
// 판정이 두 곳이 되고, 둘이 어긋나는 날 어느 쪽이 맞는지 아무도 모른다.
// 서비스롤을 안 쓰므로 그 정책을 지나갈 길이 없다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { isUserSettable, HIT_STATUS } from '@/lib/rfp/radar/hit-status'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const { id } = await ctx.params

  let body: { status?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  /*
    아는 상태만 받는다. 표의 CHECK 가 마지막 방어지만 거기까지 가면 오류 글이
    사용자 말이 아니라 DB 말이 된다. 그리고 `adopted` 는 담기 경로가 정하는 것이라
    화면이 지어낼 수 없어야 한다 — 그것까지 받으면 케이스도 없이 케이스가 된 척하는 줄이 생긴다
  */
  if (!isUserSettable(body.status)) {
    return NextResponse.json({ error: '바꿀 수 없는 상태입니다' }, { status: 400 })
  }

  const db = await createClient()
  const { data, error } = await (db as never as {
    from(t: string): {
      update(v: unknown): {
        eq(k: string, v: string): { select(c: string): Promise<{ data: unknown; error: unknown }> }
      }
    }
  }).from('rfp_radar_hits').update({ status: body.status }).eq('id', id).select('id, status')

  if (error) {
    return NextResponse.json({ error: '상태를 바꾸지 못했습니다' }, { status: 500 })
  }
  // 0행이면 내 조직 것이 아니거나 없는 것이다. 어느 쪽인지 말하지 않는다 — 있는지 없는지를
  // 대답으로 알려 주면 남의 조직 적중이 있는지를 물어볼 수 있게 된다
  const rows = (data ?? []) as unknown[]
  if (rows.length === 0) {
    return NextResponse.json({ error: '찾지 못했습니다' }, { status: 404 })
  }
  return NextResponse.json({ hit: rows[0], dismissed: body.status === HIT_STATUS.dismissed })
}
