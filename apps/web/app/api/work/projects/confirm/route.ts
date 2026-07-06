import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { parseProjectMeta, PROJECT_SELECT } from '@/lib/work/project-fields'
import { logProjectActivity } from '@/lib/work/project-activity'

// POST /api/work/projects/confirm — suggest 후보를 사용자가 확인 후 "확정 생성".
//  { name, logIds?[], ...meta } → 프로젝트 1건 생성 + logIds를 work_entity_links(kind=project)로 연결.
//  §5-3: 사용자가 명시 확정한 경우에만 생성(자동 아님). 연결되는 업무는 본인 소유만(IDOR 방지).

const NAME_MAX = 200
const LOGS_MAX = 200

export async function POST(req: NextRequest) {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const supabase = await createClient()
  const user = auth.user

  const raw = await req.json().catch(() => null) as Record<string, unknown> | null
  const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
  if (!name) return NextResponse.json({ error: '프로젝트 이름은 필수입니다' }, { status: 400 })
  if (name.length > NAME_MAX) return NextResponse.json({ error: `이름은 ${NAME_MAX}자 이하여야 합니다` }, { status: 400 })

  const meta = parseProjectMeta(raw ?? {})
  if ('error' in meta) return NextResponse.json({ error: meta.error }, { status: 400 })

  const logIds = Array.isArray(raw?.logIds)
    ? (raw!.logIds as unknown[]).filter((v): v is string => typeof v === 'string').slice(0, LOGS_MAX)
    : []

  // 1) 프로젝트 생성(RLS owner). POST /api/projects와 동일 SSOT 필드.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: project, error } = await db
    .from('projects')
    .insert({ name, user_id: user.id, ...meta.fields })
    .select(PROJECT_SELECT)
    .single()
  if (error) {
    await logProjectActivity(supabase, {
      ownerId: user.id, actorId: user.id, action: 'ai_confirm', status: 'failure',
      error, evidence: { name, requestedLinks: logIds.length },
    })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 2) 선택된 업무를 프로젝트로 연결(본인 소유 업무만). 멱등 upsert.
  let linked = 0
  let linkFailed = false
  if (logIds.length > 0) {
    const { data: owned } = await db.from('daily_logs').select('id').eq('user_id', user.id).in('id', logIds)
    const ownedIds = ((owned ?? []) as Array<{ id: string }>).map((r) => r.id)
    if (ownedIds.length > 0) {
      const links = ownedIds.map((logId) => ({
        log_id: logId, kind: 'project', entity_id: project.id, created_by: 'user', weak: false,
      }))
      const { error: linkErr } = await db
        .from('work_entity_links')
        .upsert(links, { onConflict: 'log_id,kind,entity_id', ignoreDuplicates: true })
      if (!linkErr) linked = ownedIds.length
      else linkFailed = true
    }
  }

  // 프로젝트는 생성됐으나 연결 요청이 실패하면 partial(=값은 저장됨을 이력으로 증명).
  await logProjectActivity(supabase, {
    projectId: project.id, ownerId: user.id, actorId: user.id, action: 'ai_confirm',
    status: linkFailed ? 'partial' : 'success',
    after: project, evidence: { name, requestedLinks: logIds.length, linkedTasks: linked },
  })

  return NextResponse.json({ ...project, linkedTasks: linked }, { status: 201 })
}
