import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateApiKey, maskApiKey } from '@/lib/apiKey'
import { prepareKeyCreate } from '@/lib/public-api/key-create'
import { parseScopes } from '@/lib/public-api/scopes'

const MAX_ACTIVE_KEYS = 10
const LIST_BASE = 'id, name, key_prefix, created_at, last_used_at, revoked_at, request_count, rate_limit_per_minute'

/** 마이그레이션 318 전 DB: 칼럼이 없다는 오류 (select 는 42703, insert 는 PGRST204) */
function isMissingColumn(error: { code?: string } | null): boolean {
  return !!error && (error.code === '42703' || error.code === 'PGRST204')
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const list = (cols: string) =>
    admin.from('api_keys').select(cols).eq('user_id', user.id).order('created_at', { ascending: false })
  let res = await list(`${LIST_BASE}, scopes, expires_at, purpose`)
  if (isMissingColumn(res.error)) res = await list(LIST_BASE)
  if (res.error) return NextResponse.json({ error: 'list_failed' }, { status: 500 })

  const keys = (res.data ?? []).map((k: Record<string, unknown>) => ({
    ...k,
    scopes: parseScopes(k.scopes),
    expires_at: (k.expires_at as string | null | undefined) ?? null,
    purpose: (k.purpose as string | null | undefined) ?? null,
    masked_key: maskApiKey(k.key_prefix as string),
    status: k.revoked_at ? 'revoked' : 'active',
  }))

  return NextResponse.json({ success: true, data: keys })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const prep = prepareKeyCreate(body, (profile?.role as string | undefined) ?? 'member', new Date())
  if (!prep.ok) {
    return NextResponse.json({ error: prep.error, scopes: prep.scopes }, { status: prep.status })
  }

  const { count } = await admin
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('revoked_at', null)

  if ((count ?? 0) >= MAX_ACTIVE_KEYS) {
    return NextResponse.json(
      { error: 'Maximum 10 active API keys allowed. Please revoke an existing key first.' },
      { status: 429 }
    )
  }

  const { key, prefix, hash } = generateApiKey()
  const base = { user_id: user.id, key_prefix: prefix, key_hash: hash }
  const insert = (row: Record<string, unknown>, cols: string) =>
    admin.from('api_keys').insert(row).select(cols).single()

  let res = await insert({ ...base, ...prep.row }, 'id, name, key_prefix, created_at, scopes, expires_at, purpose')
  // 318 전 DB 는 범위 만료를 못 담는다, 그때 키는 예전처럼 read 만이고 만료가 없다
  if (isMissingColumn(res.error)) res = await insert({ ...base, name: prep.row.name }, 'id, name, key_prefix, created_at')
  if (res.error) return NextResponse.json({ error: 'create_failed' }, { status: 500 })

  return NextResponse.json({
    success: true,
    data: {
      ...res.data,
      scopes: parseScopes(res.data?.scopes),
      expires_at: res.data?.expires_at ?? null,
      purpose: res.data?.purpose ?? null,
      key,
      note: 'Store this key securely — it will not be shown again.',
    },
  })
}
