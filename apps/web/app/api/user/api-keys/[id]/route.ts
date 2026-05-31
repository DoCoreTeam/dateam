import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: existing } = await admin
    .from('api_keys')
    .select('id, user_id, revoked_at')
    .eq('id', params.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'API key not found' }, { status: 404 })
  if (existing.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (existing.revoked_at) return NextResponse.json({ error: 'API key already revoked' }, { status: 409 })

  const { error } = await admin
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, message: 'API key revoked successfully.' })
}
