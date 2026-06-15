import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { runAutolink } from '@/lib/work/autolink-run'
import { recomputeThresholds } from '@/lib/work/autolink-learn'

// 업무 자동 연관 연결 — 조회/실행/해제.
//  GET  ?logId=   → 해당 업무의 자동연결(업무·엔티티) 목록(근거·신뢰도·weak 포함, 이름 resolve)
//  POST { logId, action:'run' }     → 완전 자동 연결 실행(무개입 트리거)
//  POST { action:'unlink', kind, linkId|toLogId } → 연결 해제 + 학습신호(autolink_feedback: unlink)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ownsLog(db: any, logId: string, userId: string): Promise<boolean> {
  const { data } = await db.from('daily_logs').select('user_id').eq('id', logId).single()
  if (!data) return false
  if (data.user_id === userId) return true
  const { data: p } = await db.from('profiles').select('role').eq('id', userId).single()
  return p?.role === 'admin'
}

export async function GET(req: NextRequest) {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const supabase = await createClient()
  const logId = new URL(req.url).searchParams.get('logId')
  if (!logId) return NextResponse.json({ error: 'logId 필요' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const [relRes, entRes] = await Promise.all([
    db.from('daily_log_relations').select('id, to_log_id, relation_type, confidence, reason, weak, created_by').eq('from_log_id', logId),
    db.from('work_entity_links').select('id, kind, entity_id, confidence, reason, weak, created_by').eq('log_id', logId),
  ])
  const rels = (relRes.data ?? []) as Array<{ to_log_id: string }>
  const ents = (entRes.data ?? []) as Array<{ kind: string; entity_id: string }>

  // 이름 resolve
  const logIds = rels.map((r) => r.to_log_id)
  const accIds = ents.filter((e) => e.kind === 'account').map((e) => e.entity_id)
  const dealIds = ents.filter((e) => e.kind === 'deal').map((e) => e.entity_id)
  const conIds = ents.filter((e) => e.kind === 'contact').map((e) => e.entity_id)
  const [logsN, accsN, dealsN, consN] = await Promise.all([
    logIds.length ? db.from('daily_logs').select('id, content').in('id', logIds) : { data: [] },
    accIds.length ? db.from('accounts').select('id, name').in('id', accIds) : { data: [] },
    dealIds.length ? db.from('deals').select('id, title').in('id', dealIds) : { data: [] },
    conIds.length ? db.from('contacts').select('id, name').in('id', conIds) : { data: [] },
  ])
  const nameMap = new Map<string, string>()
  for (const r of (logsN.data ?? [])) nameMap.set('log:' + r.id, String(r.content ?? '').slice(0, 80))
  for (const r of (accsN.data ?? [])) nameMap.set('account:' + r.id, r.name)
  for (const r of (dealsN.data ?? [])) nameMap.set('deal:' + r.id, r.title)
  for (const r of (consN.data ?? [])) nameMap.set('contact:' + r.id, r.name)

  return NextResponse.json({
    relations: (relRes.data ?? []).map((r: Record<string, unknown>) => ({ ...r, label: nameMap.get('log:' + r.to_log_id) ?? '(업무)' })),
    entities: (entRes.data ?? []).map((e: Record<string, unknown>) => ({ ...e, label: nameMap.get(`${e.kind}:${e.entity_id}`) ?? '(삭제됨)' })),
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const supabase = await createClient()
  const user = auth.user
  let body: { logId?: unknown; action?: unknown; kind?: unknown; linkId?: unknown; toLogId?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }
  const action = typeof body.action === 'string' ? body.action : 'run'
  const adminClient = createAdminClient()

  if (action === 'run') {
    const logId = typeof body.logId === 'string' ? body.logId : ''
    if (!logId) return NextResponse.json({ error: 'logId 필요' }, { status: 400 })
    if (!(await ownsLog(supabase, logId, user.id))) return NextResponse.json({ error: '권한 없음' }, { status: 403 })
    const result = await runAutolink(logId, user.id, user.id)
    return NextResponse.json(result, { status: result.ok ? 200 : 500 })
  }

  if (action === 'unlink') {
    const kind = typeof body.kind === 'string' ? body.kind : ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = adminClient as any
    let target_kind = kind, target_id: string | null = null
    let ownerLogId = ''
    if (kind === 'log') {
      // 업무↔업무 연결: from_log_id(소유 로그) 권한 검증 필수
      const linkId = typeof body.linkId === 'string' ? body.linkId : ''
      const toLogId = typeof body.toLogId === 'string' ? body.toLogId : ''
      let row: { id: string; from_log_id: string; to_log_id: string } | null = null
      if (linkId) { const { data } = await db.from('daily_log_relations').select('id, from_log_id, to_log_id').eq('id', linkId).single(); row = data }
      else { const { data } = await db.from('daily_log_relations').select('id, from_log_id, to_log_id').eq('from_log_id', typeof body.logId === 'string' ? body.logId : '').eq('to_log_id', toLogId).limit(1).maybeSingle(); row = data }
      if (!row) return NextResponse.json({ error: '연결을 찾을 수 없습니다' }, { status: 404 })
      ownerLogId = row.from_log_id
      if (!(await ownsLog(supabase, ownerLogId, user.id))) return NextResponse.json({ error: '권한 없음' }, { status: 403 })
      await db.from('daily_log_relations').delete().eq('id', row.id)
      target_id = row.to_log_id
    } else {
      const linkId = typeof body.linkId === 'string' ? body.linkId : ''
      if (!linkId) return NextResponse.json({ error: 'linkId 필요' }, { status: 400 })
      const { data: row } = await db.from('work_entity_links').select('log_id, entity_id, kind').eq('id', linkId).single()
      if (!row) return NextResponse.json({ error: '연결을 찾을 수 없습니다' }, { status: 404 })
      ownerLogId = row.log_id
      if (!(await ownsLog(supabase, ownerLogId, user.id))) return NextResponse.json({ error: '권한 없음' }, { status: 403 })
      target_kind = row.kind ?? kind; target_id = row.entity_id ?? null
      await db.from('work_entity_links').delete().eq('id', linkId)
    }
    const logId = ownerLogId
    // 학습신호: 해제 = 오답 → 임계 보정/정정 메모리에 사용
    await db.from('autolink_feedback').insert({
      log_id: logId || null, target_kind, target_id, action: 'unlink', created_by: user.id,
    }).then(undefined, () => {})
    // L1: 해제(오답) 누적 → 임계 자동 보정(자가보정 루프)
    await recomputeThresholds(db).catch(() => {})
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'action은 run|unlink' }, { status: 400 })
}
