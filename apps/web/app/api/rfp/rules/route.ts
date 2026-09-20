// GET   /api/rfp/rules — 이상 조항 규칙 목록
// PATCH /api/rfp/rules — 규칙 켜고 끄기
//
// 왜 생겼나: 화면에 스위치가 있는데 **저장 창구가 없었다**(실측 2026-09-16).
//   `RuleSettings` 가 `setEnabled` 로 화면 상태만 바꾸고 fetch 는 0건이었다.
//   사용자는 켠 줄 알고, 우리는 안 켜진 채로 돌고, 다음에 들어오면 꺼져 있다.
//   그때 사용자는 자기가 잘못 눌렀다고 생각하고 다시 켠다.
//
// 규칙은 DB 에 두고 코드는 실행기만 갖는다(설계서 3.8.2). 임계값이 바뀔 때 배포를
//   기다리지 않아야 하고, 무엇이 켜져 있는지 화면에서 보여야 한다.
//
// 기본 규칙은 코드에 있고 DB 에는 **바뀐 것만** 있다. 그래서 켜고 끄기는 upsert 다 —
//   처음 끄는 규칙은 DB 에 행이 없다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { DEFAULT_RULES, RULE_COLS, toRow, toRule, type AnomalyRule } from '@/lib/rfp/anomaly/rules'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const db = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any).from('rfp_anomaly_rules').select(RULE_COLS).limit(100)
  if (error) return NextResponse.json({ error: '규칙을 불러오지 못했습니다' }, { status: 500 })

  const saved = ((data as Record<string, unknown>[] | null) ?? []).map(toRule)
  const byId = new Map(saved.map((r: AnomalyRule) => [r.id, r]))
  // 기본값 위에 저장된 것을 덮는다. 화면이 보는 것과 같은 규칙이다
  return NextResponse.json({ rules: DEFAULT_RULES.map((d) => byId.get(d.id) ?? d) })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: '요청을 읽지 못했습니다' }, { status: 400 })
  }

  const ruleId = typeof body.rule_id === 'string' ? body.rule_id.trim() : ''
  if (!ruleId) return NextResponse.json({ error: 'missing_rule_id' }, { status: 400 })
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'missing_enabled' }, { status: 400 })
  }

  // 없는 규칙을 켜 두면 화면에는 안 보이는데 DB 에는 남는다. 그 행은 아무도 못 지운다
  const known = DEFAULT_RULES.find((r) => r.id === ruleId)
  if (!known) return NextResponse.json({ error: 'unknown_rule' }, { status: 400 })

  const db = await createClient()

  /*
    조직은 서버가 정한다 — 요청이 org_id 를 보내면 남의 조직 규칙을 바꿀 수 있다
    (app/api/rfp/cases/route.ts 와 같은 방식). 비워 두면 표 정책
    `rfp_anomaly_rules_admin` (org_id is not null and rfp_is_admin(org_id))이 막는다.
  */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgId, error: orgError } = await (db as any).rpc('rfp_default_org')
  if (orgError || !orgId) {
    return NextResponse.json({ error: '조직을 찾지 못했습니다' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any)
    .from('rfp_anomaly_rules')
    .upsert(toRow({ ...known, enabled: body.enabled }, String(orgId)), { onConflict: 'id' })

  if (error) {
    // supabase 는 insert 오류를 던지지 않고 돌려준다. 읽지 않으면 조용히 0건이 된다
    console.error('[rfp] 규칙 저장 실패', error)
    return NextResponse.json({ error: '규칙을 저장하지 못했습니다' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, rule_id: ruleId, enabled: body.enabled })
}
