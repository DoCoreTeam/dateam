// POST /api/rfp/cases/from-url — **링크 한 줄로 케이스를 만든다**
//
// 사람이 공고를 볼 때 손에 쥐고 있는 것은 주소창의 주소다. 첨부를 하나씩 내려받아
// 다시 올리게 하는 것은 시스템이 할 수 있는 일을 사람에게 시키는 것이다.
//
// **등급은 여기서도 사람이 고른다.** 나라장터 첨부는 대개 공개지만 기관 사이트에서
// 받은 것은 아닐 수 있다. 기본값을 주면 그 판단이 사라진다.
//
// 케이스를 만들고 첨부를 저장하는 일은 레이더가 쓰는 것과 **같은 배선**을 탄다
// (lib/rfp/intake/adopt-source.ts). 두 벌로 두면 한쪽만 고쳐진다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { isDocClass } from '@/lib/rfp/domain/doc-class'
import { previewNotice, isFail, type NoticePreview } from '@/lib/rfp/intake/notice-preview'
import { realPreviewDeps } from '@/lib/rfp/intake/preview-deps'
import { adoptSource } from '@/lib/rfp/intake/adopt-source'
import { realAdoptPorts } from '@/lib/rfp/intake/adopt-ports'
import { sourceRowFromPreview } from '@/lib/rfp/intake/source-row'

export const dynamic = 'force-dynamic'
// 첨부를 실제로 받아 저장한다. 기관 파일 서버는 느린 곳이 많다
export const maxDuration = 300

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  let body: { url?: unknown; docClass?: unknown }
  try {
    body = (await req.json()) as { url?: unknown; docClass?: unknown }
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  // 등급을 안 고르면 만들지 않는다 — 기본값을 주면 비공개 문서가 공개로 들어온다
  if (!isDocClass(body.docClass)) {
    return NextResponse.json({ error: 'missing_doc_class' }, { status: 400 })
  }
  const docClass = body.docClass

  const admin = createAdminClient()
  const preview = await previewNotice(body.url, realPreviewDeps(admin))
  if (isFail(preview)) {
    return NextResponse.json(
      { error: preview.error, fallback: preview.fallback, url: preview.url },
      { status: preview.status },
    )
  }

  const db = await createClient()
  const { data: orgId } = await (db as any).rpc('rfp_default_org')
  if (!orgId) return NextResponse.json({ error: 'no_org' }, { status: 403 })

  const source = await findOrCreateSource(db, String(orgId), preview)
  if (!source) return NextResponse.json({ error: 'source_failed' }, { status: 500 })

  const result = await adoptSource({
    sourceId: source.id,
    orgId: String(orgId),
    title: preview.title,
    docClass,
    userId: gate.user.id,
    budgetAmount: preview.budgetAmount,
    attachments: preview.attachments.map((a, i) => ({ fileName: a.name, url: a.url, slot: i + 1 })),
    noticeUrl: preview.url,
    emptyReason: preview.reason,
  }, realAdoptPorts(db, admin))

  if ('error' in result) {
    return NextResponse.json({ error: 'case_create_failed' }, { status: 500 })
  }

  // 무엇을 받았고 무엇을 못 받았는지 화면이 그대로 보여 준다
  return NextResponse.json({
    case: { id: result.caseId },
    reused: result.reused,
    attached: result.attached,
    failed: result.failed,
    job: result.job,
    noticeUrl: result.noticeUrl,
    attachmentReason: result.attachmentReason,
    title: preview.title,
  }, { status: result.reused ? 200 : 201 })
}

/**
 * 같은 공고를 두 번 담지 않는다.
 *
 * 유니크가 **부분 인덱스**(notice_no 가 있을 때만)라 upsert 로는 못 맞춘다.
 * 그래서 먼저 찾고, 없으면 넣고, 그 사이에 남이 넣었으면(23505) 다시 찾는다.
 */
async function findOrCreateSource(
  db: any, orgId: string, preview: NoticePreview,
): Promise<{ id: string } | null> {
  const row = sourceRowFromPreview(preview, orgId)

  const find = async () => {
    let q = db.from('rfp_sources').select('id')
      .eq('org_id', orgId).eq('source_system', row.source_system).eq('notice_no', row.notice_no)
    q = row.notice_round === null ? q.is('notice_round', null) : q.eq('notice_round', row.notice_round)
    const { data } = await q.maybeSingle()
    return data ? { id: String(data.id) } : null
  }

  const found = await find()
  if (found) return found

  const { data, error } = await db.from('rfp_sources').insert(row).select('id').single()
  if (data) return { id: String(data.id) }
  // 같은 순간에 남이 넣었으면 그것을 쓴다 — 실패가 아니다
  if (error) return find()
  return null
}
