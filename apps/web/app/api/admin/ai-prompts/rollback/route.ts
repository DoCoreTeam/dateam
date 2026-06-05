import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { rollbackPrompt } from '@/lib/gpu/prompt-governance'

// 축6 사람 수동 롤백 — 지정 revision의 content를 다시 active로 복원(D3: 사람의 역할=롤백).
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const body = await req.json().catch(() => ({}))
  const revisionId = typeof body.revision_id === 'string' ? body.revision_id : ''
  if (!revisionId) return NextResponse.json({ error: 'revision_id 필요' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  const { data: rev } = await db.from('ai_prompt_revisions').select('prompt_key, version, content').eq('id', revisionId).maybeSingle()
  if (!rev) return NextResponse.json({ error: 'revision 없음' }, { status: 404 })

  const r = await rollbackPrompt(db, {
    promptKey: rev.prompt_key, toContent: rev.content, toVersion: rev.version,
    by: auth.user?.email ?? 'admin', auto: false, reason: '관리자 수동 롤백', nowIso: new Date().toISOString(),
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true, restored: rev.version })
}
