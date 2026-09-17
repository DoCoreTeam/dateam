// POST /api/rfp/sources/[id]/adopt — 공고를 케이스로 만들고 **첨부까지 받아 온다**
//
// 공고에는 제안요청서·과업내용서가 이미 붙어 있다. 그걸 사람이 다시 내려받아 다시 올리게 하면
// 시스템이 이미 아는 것을 두 번 시키는 것이다. 공고를 골랐으면 첨부는 따라온다.
//
// **등급은 사람이 고른다.** 나라장터 공고 첨부는 대개 공개지만, 기관 사이트에서 받은 것은
// 아닐 수 있다. 기본값을 주면 그 판단이 사라진다.
//
// 케이스를 만들고 첨부를 저장하는 일 자체는 lib/rfp/intake/adopt-source.ts 가 한다 —
// 사람이 링크를 붙여넣는 길과 **같은 배선을 쓴다.** 두 벌로 두면 한쪽만 고쳐진다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { isDocClass } from '@/lib/rfp/domain/doc-class'
import { attachmentsOf, type NoticeAttachment } from '@/lib/rfp/g2b/attachments'
import { detailCandidates, verifyDetailUrl, matchesTitle } from '@/lib/rfp/radar/detail-url'
import { attachmentsFromPageDeep } from '@/lib/rfp/radar/attachments-from-page'
import { fetchPage } from '@/lib/rfp/radar/site-collect'
import { adoptSource } from '@/lib/rfp/intake/adopt-source'
import { realAdoptPorts } from '@/lib/rfp/intake/adopt-ports'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const { id: sourceId } = await ctx.params
  const body = await readBody(req)
  // 등급을 안 고르면 만들지 않는다 — 기본값을 주면 비공개 문서가 공개로 들어온다
  if (!isDocClass(body.docClass)) {
    return NextResponse.json({ error: 'missing_doc_class' }, { status: 400 })
  }
  const docClass = body.docClass

  const db = await createClient()
  const { data: source } = await (db as any)
    .from('rfp_sources')
    .select('id, org_id, title, notice_no, budget_amount, raw')
    .eq('id', sourceId)
    .maybeSingle()
  if (!source) return NextResponse.json({ error: '공고를 찾지 못했습니다' }, { status: 404 })

  // ── 첨부 찾기 ──
  //
  // 두 갈래다. 나라장터는 첨부 주소를 칸으로 주고(`ntceSpecDocUrl1~10`),
  // **기관 자체 게시판은 상세 쪽 HTML 안에 링크로만 있다.**
  // 상세 주소조차 없는 자바스크립트 게시판이면 목록에서 후보를 만들어 열어 본다.
  const raw = (source.raw ?? {}) as Record<string, unknown>
  let attachments: NoticeAttachment[] = attachmentsOf(raw)
  let detailUrl: string | null = typeof raw.url === 'string' ? raw.url : null
  let emptyReason: string | null = null

  if (attachments.length === 0) {
    const found = await findFromSite(source, detailUrl)
    attachments = found.attachments
    detailUrl = found.detailUrl ?? detailUrl
    emptyReason = found.reason
  }

  const result = await adoptSource({
    sourceId: String(source.id),
    orgId: String(source.org_id),
    title: typeof source.title === 'string' ? source.title : null,
    docClass,
    userId: gate.user.id,
    budgetAmount: typeof source.budget_amount === 'number' ? source.budget_amount : null,
    attachments,
    noticeUrl: detailUrl,
    emptyReason,
  }, realAdoptPorts(db, createAdminClient()))

  if ('error' in result) {
    return NextResponse.json({ error: '케이스를 만들지 못했습니다' }, { status: 500 })
  }
  if (result.reused) {
    return NextResponse.json({ case: { id: result.caseId }, reused: true }, { status: 200 })
  }

  // 무엇을 받았고 무엇을 못 받았는지 화면이 그대로 보여 준다
  return NextResponse.json({
    case: { id: result.caseId },
    attached: result.attached,
    failed: result.failed,
    job: result.job,
    noticeUrl: result.noticeUrl,
    attachmentReason: result.attachmentReason,
  }, { status: 201 })
}

interface FoundAttachments {
  attachments: NoticeAttachment[]
  detailUrl: string | null
  reason: string | null
}

/**
 * 기관 게시판에서 첨부를 찾는다.
 *
 * ① 상세 주소를 알면 그 쪽을 연다
 * ② 모르면(자바스크립트 게시판) 목록에서 후보를 만들어 **열어 보고 첨부가 있는 쪽만** 쓴다
 *
 * 어느 쪽도 안 되면 사유를 남긴다. 조용히 빈손으로 돌아오면 화면이 설명할 말이 없다.
 */
async function findFromSite(
  source: { org_id: string; title: string | null }, knownUrl: string | null,
): Promise<FoundAttachments> {
  if (knownUrl) {
    const page = await fetchPage(knownUrl)
    if (!page.ok) return { attachments: [], detailUrl: knownUrl, reason: page.reason }
    const found = await attachmentsFromPageDeep(page.html, knownUrl)
    return {
      attachments: found,
      detailUrl: knownUrl,
      reason: found.length === 0 ? 'no_attachment_on_page' : null,
    }
  }

  // 상세 주소를 모른다 — 자바스크립트 게시판이다. 목록에서 되짚는다
  const db = await createClient()
  const { data: sites } = await (db as any)
    .from('rfp_source_sites').select('url, base_url').eq('kind', 'web')
    .is('deleted_at', null).eq('enabled', true)

  for (const site of ((sites ?? []) as { url: string | null }[])) {
    if (!site.url) continue
    const list = await fetchPage(site.url)
    if (!list.ok) continue

    const rows = detailCandidates(list.html, site.url)
    const row = rows.find((r) => matchesTitle(r.text, String(source.title ?? '')))
    if (!row) continue

    const hit = await verifyDetailUrl(row.urls)
    if (!hit) return { attachments: [], detailUrl: null, reason: 'detail_not_found' }

    const found = await attachmentsFromPageDeep(hit.html, hit.url)
    return {
      attachments: found,
      detailUrl: hit.url,
      reason: found.length === 0 ? 'no_attachment_on_page' : null,
    }
  }

  return { attachments: [], detailUrl: null, reason: 'notice_page_unknown' }
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    return ((await req.json()) ?? {}) as Record<string, unknown>
  } catch {
    return {}
  }
}
