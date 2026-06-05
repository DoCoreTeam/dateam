import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { recordRevision } from '@/lib/gpu/prompt-governance'

// 축6/7 관리자 프롬프트 운영 API. ?view=list|history|schema
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export async function GET(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const view = new URL(req.url).searchParams.get('view') ?? 'list'
  const db = createAdminClient() as Db

  if (view === 'schema') {
    const { data } = await db.rpc('get_schema_digest')
    const tables = Array.from(String(data ?? '').matchAll(/TABLE (\w+)/g)).map((m) => m[1])
    return NextResponse.json({ digest: data ?? '', tables })
  }
  if (view === 'history') {
    const key = new URL(req.url).searchParams.get('prompt_key')
    let q = db.from('ai_prompt_revisions').select('id, prompt_key, version, source, event, reason, trigger, created_by, created_at').order('created_at', { ascending: false }).limit(200)
    if (key) q = q.eq('prompt_key', key)
    const { data } = await q
    return NextResponse.json({ revisions: data ?? [] })
  }
  // list — 활성 우선, 키별
  const { data } = await db.from('ai_prompts').select('id, prompt_key, version, active, source, model_hint, updated_at, updated_by, content').order('prompt_key').order('active', { ascending: false })
  return NextResponse.json({ prompts: data ?? [] })
}

// 수동 편집 / 활성 토글 (관리자, D2). 편집은 감사 기록.
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  const db = createAdminClient() as Db
  const now = new Date().toISOString()
  const actor = auth.user?.email ?? 'admin'

  const { data: cur } = await db.from('ai_prompts').select('prompt_key, content, active').eq('id', id).maybeSingle()
  if (!cur) return NextResponse.json({ error: '대상 없음' }, { status: 404 })

  if (typeof body.content === 'string' && body.content !== cur.content) {
    await db.from('ai_prompts').update({ content: body.content, source: 'human', updated_by: actor, updated_at: now }).eq('id', id)
    await recordRevision(db, { promptKey: cur.prompt_key, version: `edit-${now.slice(0, 19)}`, content: body.content, source: 'human', event: 'edited', reason: '관리자 수동 편집', trigger: 'manual', createdBy: actor, prevContent: cur.content, nowIso: now })
  }
  if (typeof body.active === 'boolean' && body.active !== cur.active) {
    if (body.active) await db.from('ai_prompts').update({ active: false, updated_at: now }).eq('prompt_key', cur.prompt_key).eq('active', true)
    await db.from('ai_prompts').update({ active: body.active, updated_by: actor, updated_at: now }).eq('id', id)
    await recordRevision(db, { promptKey: cur.prompt_key, version: `toggle-${now.slice(0, 19)}`, content: cur.content, source: 'human', event: body.active ? 'activated' : 'deactivated', reason: `관리자 ${body.active ? '활성화' : '비활성화'}`, trigger: 'manual', createdBy: actor, nowIso: now })
  }
  return NextResponse.json({ ok: true })
}
