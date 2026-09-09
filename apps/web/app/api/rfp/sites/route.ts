// GET    /api/rfp/sites — 어디를 뒤질지
// POST   /api/rfp/sites — 사이트 추가
// PATCH  /api/rfp/sites — 켜고 끄기 · 서비스 키 저장
// DELETE /api/rfp/sites?id= — 사이트 빼기
//
// 입찰 공고는 **기관 자기 게시판에도 올라온다.** 나라장터만 보면 그 며칠을 늘 늦게 안다.
// 그동안 「어디를 볼지」를 정할 자리가 아예 없어서 나라장터 하나로 고정돼 있었다.
//
// 나라장터 서비스 키는 **여기서 안 받는다** — 외부 API 키는 관리자 설정 한 곳이다.
// 여기서는 키가 있는지만 알려 준다(값은 절대 안 내보낸다).

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { G2B_KEY_FIELD } from '@/lib/rfp/g2b/client'

export const dynamic = 'force-dynamic'

const COLS = 'id, name, kind, url, base_url, enabled, last_run_at, last_result, note'

export async function GET() {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const db = await createClient()
  const { data, error } = await (db as any)
    .from('rfp_source_sites').select(COLS).is('deleted_at', null)
    .order('kind', { ascending: true }).order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: '목록을 불러오지 못했습니다' }, { status: 500 })

  // 키가 있는지만 말한다. **값은 절대 내보내지 않는다**
  const admin = createAdminClient()
  const { data: metaRow } = await (admin as any)
    .from('org_content').select('value').eq('key', 'META').single()
  const meta = ((metaRow as { value?: unknown } | null)?.value ?? {}) as Record<string, unknown>

  return NextResponse.json({
    sites: data ?? [],
    hasServiceKey: typeof meta[G2B_KEY_FIELD] === 'string' && String(meta[G2B_KEY_FIELD]).trim().length > 0,
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const body = await readBody(req)
  const name = str(body.name)
  const url = str(body.url)
  if (!name) return NextResponse.json({ error: 'missing_name' }, { status: 400 })
  // 목록 쪽 주소가 없으면 뒤질 데가 없다
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'invalid_url' }, { status: 400 })
  }

  const db = await createClient()
  const { data: orgId } = await (db as any).rpc('rfp_default_org')
  if (!orgId) return NextResponse.json({ error: '조직을 찾지 못했습니다' }, { status: 403 })

  const { data, error } = await (db as any)
    .from('rfp_source_sites')
    .insert({
      org_id: orgId,
      name,
      kind: 'web',
      url,
      // 상대 링크를 절대 주소로 만들 기준. 안 주면 목록 쪽 주소를 기준으로 삼는다
      base_url: str(body.baseUrl) ?? new URL(url).origin,
      note: str(body.note),
      created_by: gate.user.id,
    })
    .select(COLS)
    .single()

  if (error) {
    if (String((error as { code?: string }).code) === '23505') {
      return NextResponse.json({ error: 'duplicate_url' }, { status: 409 })
    }
    return NextResponse.json({ error: '사이트를 추가하지 못했습니다' }, { status: 500 })
  }
  return NextResponse.json({ site: data }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const body = await readBody(req)

  // 서비스 키는 **여기서 안 받는다.** 외부 API 키는 관리자 설정 한 곳이다
  // (app/admin/settings/G2bSettings). 받는 곳이 둘이면 하나는 반드시 낡는다.
  const id = str(body.id)
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (str(body.name)) patch.name = str(body.name)
  if (str(body.url)) patch.url = str(body.url)
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing_to_change' }, { status: 400 })
  }

  const db = await createClient()
  const { data, error } = await (db as any)
    .from('rfp_source_sites').update(patch).eq('id', id).select(COLS).single()
  if (error) return NextResponse.json({ error: '사이트를 고치지 못했습니다' }, { status: 500 })
  return NextResponse.json({ site: data })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const db = await createClient()
  // 이 사이트에서 가져온 공고는 남긴다 — 빼자마자 어제 본 공고가 사라지면 안 된다
  const { error } = await (db as any)
    .from('rfp_source_sites').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ error: '사이트를 빼지 못했습니다' }, { status: 500 })
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
