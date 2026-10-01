// PATCH /api/rfp/radar/hits — 고른 적중 여럿의 상태를 한 번에 바꾼다
//
// 쉰 줄에서 상관없는 것을 하나씩 빼는 것은 쓸 수 있는 방법이 아니다. 골라서 한 번에 뺀다.
//
// 한 건 창구와 같은 규칙을 쓴다 — 로그인만 확인하고 조직 판정은 표 정책에 맡기며
// 서비스롤을 안 쓴다. 다른 점은 **상한**뿐이다: 상한이 없으면 「전부 고르기」가
// 수천 건을 한 요청에 실어 보내고 그 요청은 타임아웃으로 죽는다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { checkBulk, MAX_BULK } from '@/lib/rfp/radar/hit-status'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  let body: { ids?: unknown; status?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  const check = checkBulk(body.ids, body.status)
  if (!check.ok) {
    // 몇 개까지인지 말한다. 「너무 많습니다」만 쓰면 몇 개로 줄여야 하는지 모른다
    const message = check.reason === 'too_many'
      ? `한 번에 ${MAX_BULK}건까지만 바꿀 수 있습니다`
      : check.reason === 'bad_status' ? '바꿀 수 없는 상태입니다' : '선택된 항목이 없습니다'
    return NextResponse.json({ error: message, reason: check.reason }, { status: 400 })
  }

  const db = await createClient()
  const { data, error } = await (db as never as {
    from(t: string): {
      update(v: unknown): {
        in(k: string, v: string[]): { select(c: string): Promise<{ data: unknown; error: unknown }> }
      }
    }
  }).from('rfp_radar_hits').update({ status: body.status }).in('id', check.ids).select('id')

  if (error) {
    return NextResponse.json({ error: '상태를 바꾸지 못했습니다' }, { status: 500 })
  }

  /*
    **바뀐 수를 세어 돌려준다.** 고른 수와 바뀐 수가 다를 수 있다 — 남의 조직 것이 섞였거나
    그 사이에 지워졌거나. 안 세면 화면은 전부 바뀐 것처럼 보이고, 사용자는 다시 열었을 때에야
    몇 개가 그대로인 것을 본다.
  */
  const changed = ((data ?? []) as { id: string }[]).map((r) => String(r.id))
  return NextResponse.json({
    changed,
    asked: check.ids.length,
    failed: check.ids.length - changed.length,
  })
}
