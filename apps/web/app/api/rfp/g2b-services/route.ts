// GET   /api/rfp/g2b-services — 포털 서비스 신청 상태
// PATCH /api/rfp/g2b-services — 신청 상태 켜고 끄기
//
// 신청 자체는 공공데이터포털에서 사람이 한다. 우리가 대신 못 하고 신청했는지도 알 수 없다.
// 여기서 하는 일은 **사람이 적어 둔 것을 보관**하는 것뿐이다.
//
// ## 권한 판정을 표에 맡긴다
//
// 창구는 로그인만 확인하고, 「관리자인가」는 표 정책(rfp_g2b_service_states_admin)이 판정한다.
// 창구에서 또 판정하면 판정이 두 곳이 되고, 둘이 어긋나는 날 어느 쪽이 맞는지 아무도 모른다.
// 서비스롤을 안 쓰므로 정책을 지나갈 길이 없다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { G2B_SERVICES, SERVICE_STATE_COLS, toServiceState, type G2bServiceId } from '@/lib/rfp/g2b/services'

export const dynamic = 'force-dynamic'

const KNOWN: ReadonlySet<string> = new Set(G2B_SERVICES.map((s) => s.id))

export async function GET() {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const db = await createClient()
  const { data, error } = await (db as never as {
    from(t: string): { select(c: string): Promise<{ data: unknown; error: unknown }> }
  }).from('rfp_g2b_service_states').select(SERVICE_STATE_COLS)

  if (error) return NextResponse.json({ error: '신청 상태를 불러오지 못했습니다' }, { status: 500 })
  return NextResponse.json({ states: ((data ?? []) as Record<string, unknown>[]).map(toServiceState) })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  let body: { serviceId?: unknown; applied?: unknown; note?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  // 모르는 서비스 id 를 받으면 표에 쓰레기 줄이 생기고 화면이 그것을 서비스로 그린다
  const serviceId = String(body.serviceId ?? '')
  if (!KNOWN.has(serviceId)) {
    return NextResponse.json({ error: '모르는 서비스입니다' }, { status: 400 })
  }
  if (typeof body.applied !== 'boolean') {
    return NextResponse.json({ error: '신청 여부가 없습니다' }, { status: 400 })
  }
  // 메모에 긴 글을 받으면 화면이 무너진다. 비밀을 적지 말라는 말은 안내로 하고 길이는 여기서 막는다
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : null

  const db = await createClient()
  // 조직은 서버가 정한다 — 요청이 보내게 두면 남의 조직 상태를 바꿀 수 있다
  const { data: orgId } = await (db as never as {
    rpc(fn: string): Promise<{ data: unknown }>
  }).rpc('rfp_default_org')
  if (!orgId) return NextResponse.json({ error: '조직을 찾지 못했습니다' }, { status: 403 })

  const { data, error } = await (db as never as {
    from(t: string): {
      upsert(v: unknown, o: unknown): { select(c: string): Promise<{ data: unknown; error: unknown }> }
    }
  }).from('rfp_g2b_service_states').upsert({
    org_id: String(orgId),
    service_id: serviceId as G2bServiceId,
    applied: body.applied,
    applied_at: body.applied ? new Date().toISOString() : null,
    note,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'org_id,service_id' }).select(SERVICE_STATE_COLS)

  if (error) {
    // 관리자가 아니면 표 정책이 막는다. 그 사실을 오류로 흐리지 않고 그대로 말한다
    return NextResponse.json({ error: '신청 상태를 저장하지 못했습니다' }, { status: 403 })
  }
  return NextResponse.json({ states: ((data ?? []) as Record<string, unknown>[]).map(toServiceState) })
}
