import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateApiKey, maskApiKey } from '@/lib/apiKey'
import { z } from 'zod'

const createSchema = z.object({
  name: z.string().min(1).max(100),
})

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('api_keys')
    .select('id, name, key_prefix, raw_key, created_at, last_used_at, revoked_at, request_count, rate_limit_per_minute')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const keys = (data ?? []).map((k: Record<string, unknown>) => ({
    ...k,
    masked_key: maskApiKey(k.key_prefix as string),
    status: k.revoked_at ? 'revoked' : 'active',
  }))

  return NextResponse.json({ success: true, data: keys })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  // Max 10 active keys per user
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { count } = await admin
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('revoked_at', null)

  if ((count ?? 0) >= 10) {
    return NextResponse.json(
      { error: 'Maximum 10 active API keys allowed. Please revoke an existing key first.' },
      { status: 429 }
    )
  }

  const { key, prefix, hash } = generateApiKey()

  const { data, error } = await admin
    .from('api_keys')
    .insert({ user_id: user.id, name: parsed.data.name, key_prefix: prefix, key_hash: hash, raw_key: key })
    .select('id, name, key_prefix, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    data: {
      ...data,
      key,
      note: 'Store this key securely — it will not be shown again.',
    },
  })
}
