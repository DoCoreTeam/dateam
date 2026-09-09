// GET    /api/rfp/radar/rules — 찾을 조건 목록
// POST   /api/rfp/radar/rules — 조건 만들기
// PATCH  /api/rfp/radar/rules — 켜고 끄기 또는 고치기
// DELETE /api/rfp/radar/rules?id= — 조건 지우기
//
// 이 파일이 뒤늦게 생긴 이유: 화면에 「조건 추가」라는 말만 있고 **만들 길이 없었다.**
// 표도 있고 거르는 코드도 있는데 조건을 넣을 수가 없어서 레이더가 늘 0건이었다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'

export const dynamic = 'force-dynamic'

const COLS = 'id, name, keywords, classifications, budget_min, budget_max, agencies, enabled, last_swept_at'

/** 조건이 넓으면 알림이 소음이 된다. 그렇다고 막지는 않고 화면이 경고한다 */
const MAX_KEYWORDS = 20

export async function GET() {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const db = await createClient()
  const { data, error } = await (db as any)
    .from('rfp_radar_rules').select(COLS).order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: '조건을 불러오지 못했습니다' }, { status: 500 })
  return NextResponse.json({ rules: data ?? [] })
}

export async function POST(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const body = await readBody(req)
  const name = str(body.name)
  // 이름 없는 조건은 목록에서 서로 구분이 안 된다
  if (!name) return NextResponse.json({ error: 'missing_name' }, { status: 400 })

  const keywords = strList(body.keywords).slice(0, MAX_KEYWORDS)
  const agencies = strList(body.agencies)
  // 조건이 하나도 없으면 모든 공고가 걸린다 — 그건 레이더가 아니라 목록이다
  if (keywords.length === 0 && agencies.length === 0
      && num(body.budgetMin) === null && num(body.budgetMax) === null) {
    return NextResponse.json({ error: 'no_condition' }, { status: 400 })
  }

  const db = await createClient()
  const { data: orgId } = await (db as any).rpc('rfp_default_org')
  if (!orgId) return NextResponse.json({ error: '조직을 찾지 못했습니다' }, { status: 403 })

  const { data, error } = await (db as any)
    .from('rfp_radar_rules')
    .insert({
      org_id: orgId,
      name,
      keywords,
      agencies,
      classifications: strList(body.classifications),
      budget_min: num(body.budgetMin),
      budget_max: num(body.budgetMax),
      enabled: body.enabled === false ? false : true,
      created_by: gate.user.id,
    })
    .select(COLS)
    .single()

  if (error) return NextResponse.json({ error: '조건을 만들지 못했습니다' }, { status: 500 })
  return NextResponse.json({ rule: data }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const body = await readBody(req)
  const id = str(body.id)
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (str(body.name)) patch.name = str(body.name)
  if (Array.isArray(body.keywords)) patch.keywords = strList(body.keywords).slice(0, MAX_KEYWORDS)
  if (Array.isArray(body.agencies)) patch.agencies = strList(body.agencies)
  if ('budgetMin' in body) patch.budget_min = num(body.budgetMin)
  if ('budgetMax' in body) patch.budget_max = num(body.budgetMax)
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing_to_change' }, { status: 400 })
  }

  const db = await createClient()
  const { data, error } = await (db as any)
    .from('rfp_radar_rules').update(patch).eq('id', id).select(COLS).single()
  if (error) return NextResponse.json({ error: '조건을 고치지 못했습니다' }, { status: 500 })
  return NextResponse.json({ rule: data })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const db = await createClient()
  // 이 조건으로 찾은 것은 남긴다 — 조건을 지웠다고 이미 찾은 공고까지 사라지면
  // 「어제 본 그 공고 어디 갔지」가 된다
  const { error } = await (db as any).from('rfp_radar_rules').delete().eq('id', id)
  if (error) return NextResponse.json({ error: '조건을 지우지 못했습니다' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    return ((await req.json()) ?? {}) as Record<string, unknown>
  } catch {
    return {}
  }
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[^0-9]/g, ''))
    return Number.isFinite(n) && v.trim() !== '' ? n : null
  }
  return null
}
function strList(v: unknown): string[] {
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean)
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim()) : []
}
