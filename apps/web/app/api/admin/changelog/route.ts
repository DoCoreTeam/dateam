import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import type { ChangeType } from '@/lib/changelog/types'
import { sanitizeChanges, normalizeType, CHANGE_TYPES as TYPES, sanitizeSearch, isVersionLike } from '@/lib/changelog/normalize'

// /api/admin/changelog — 어드민 체인지로그 관리(전체 조회/생성). requireAdminApi 게이트.
const SORT_WHITELIST = new Set(['released_at', 'version', 'created_at', 'sort_order', 'updated_at'])

// GET ?q=&type=&published=&sort=&dir=&page=&limit=
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const admin = createAdminClient()
  const sp = req.nextUrl.searchParams

  const q = sanitizeSearch(sp.get('q') ?? '')   // PostgREST or-필터 인젝션 방지
  const type = sp.get('type')
  const published = sp.get('published')
  const sort = SORT_WHITELIST.has(sp.get('sort') ?? '') ? (sp.get('sort') as string) : 'released_at'
  const ascending = sp.get('dir') === 'asc'
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '20', 10) || 20))
  const from = (page - 1) * limit

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any).from('app_releases').select('*', { count: 'exact' })
  if (q) query = query.or(`version.ilike.%${q}%,title.ilike.%${q}%`)
  if (type && TYPES.has(type as ChangeType)) query = query.eq('type', type)
  if (published === 'true' || published === 'false') query = query.eq('is_published', published === 'true')
  query = query.order(sort, { ascending, nullsFirst: false })
  // 날짜 동률 시 버전 내림차순 보조정렬(공개 /api/changelog와 동일 SSOT) — 같은 날짜 행이 삽입순으로 섞이지 않게.
  if (sort !== 'version') query = query.order('version', { ascending: false })
  query = query.range(from, from + limit - 1)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [], meta: { total: count ?? 0, page, limit } })
}

// POST — 신규 생성
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '잘못된 요청' }, { status: 400 }) }

  const version = typeof body.version === 'string' ? body.version.trim() : ''
  if (!version) return NextResponse.json({ error: '버전은 필수입니다' }, { status: 400 })
  if (!isVersionLike(version)) return NextResponse.json({ error: '버전 형식이 올바르지 않습니다(영숫자·점·하이픈)' }, { status: 400 })
  const type = normalizeType(body.type)

  const row = {
    version,
    released_at: typeof body.released_at === 'string' && body.released_at ? body.released_at : null,
    title: typeof body.title === 'string' ? body.title.trim().slice(0, 300) : null,
    changes: sanitizeChanges(body.changes),
    type,
    is_published: body.is_published === true,
    sort_order: typeof body.sort_order === 'number' ? body.sort_order : null,
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any).from('app_releases').insert(row).select('*').single()
  if (error) {
    const dup = /duplicate|unique/i.test(error.message)
    return NextResponse.json({ error: dup ? '이미 존재하는 버전입니다' : error.message }, { status: dup ? 409 : 500 })
  }
  return NextResponse.json({ item: data }, { status: 201 })
}
