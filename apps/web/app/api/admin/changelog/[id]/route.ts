import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { sanitizeChanges, normalizeType, isVersionLike } from '@/lib/changelog/normalize'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// PATCH /api/admin/changelog/[id] — 수정·게시토글. DELETE — 삭제.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '잘못된 요청' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}
  if (typeof body.version === 'string') {
    const v = body.version.trim()
    if (!isVersionLike(v)) return NextResponse.json({ error: '버전 형식이 올바르지 않습니다' }, { status: 400 })
    patch.version = v
  }
  if ('released_at' in body) patch.released_at = typeof body.released_at === 'string' && body.released_at ? body.released_at : null
  if ('title' in body) patch.title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : null
  if ('changes' in body) patch.changes = sanitizeChanges(body.changes)
  if ('type' in body) patch.type = normalizeType(body.type)
  if ('is_published' in body) patch.is_published = body.is_published === true
  if ('sort_order' in body) patch.sort_order = typeof body.sort_order === 'number' ? body.sort_order : null
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '변경할 내용이 없습니다' }, { status: 400 })

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any).from('app_releases').update(patch).eq('id', params.id).select('*').single()
  if (error) {
    const dup = /duplicate|unique/i.test(error.message)
    return NextResponse.json({ error: dup ? '이미 존재하는 버전입니다' : error.message }, { status: dup ? 409 : 500 })
  }
  return NextResponse.json({ item: data })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 })
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('app_releases').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
