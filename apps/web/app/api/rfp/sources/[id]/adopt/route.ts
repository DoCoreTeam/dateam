// POST /api/rfp/sources/[id]/adopt — 공고를 케이스로 만들고 **첨부까지 받아 온다**
//
// 공고에는 제안요청서·과업내용서가 이미 붙어 있다. 그걸 사람이 다시 내려받아 다시 올리게 하면
// 시스템이 이미 아는 것을 두 번 시키는 것이다. 공고를 골랐으면 첨부는 따라온다.
//
// **등급은 사람이 고른다.** 나라장터 공고 첨부는 대개 공개지만, 기관 사이트에서 받은 것은
// 아닐 수 있다. 기본값을 주면 그 판단이 사라진다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { isDocClass } from '@/lib/rfp/domain/doc-class'
import { attachmentsOf, downloadAttachment } from '@/lib/rfp/g2b/attachments'
import { filePath, putBytes } from '@/lib/rfp/db/storage'
import { sha256Hex } from '@/lib/rfp/db/files'
import { MAX_FILE_BYTES } from '@/lib/rfp/db/limits'
import { guessFileRole } from '@/lib/rfp/parse/role'
import { checkKind } from '@/lib/rfp/parse/quality'
import { enqueueJob } from '@/lib/rfp/jobs/queue'
import { dedupeKey, JOB_PRIORITY } from '@/lib/rfp/jobs/stages'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** 첨부를 몇 개까지 받나. 공고 하나에 서식이 수십 개 붙는 일이 있다 */
const MAX_ATTACHMENTS = 12

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

  // 같은 공고로 이미 만든 케이스가 있으면 그것을 준다 — 두 번 만들면 분석 비용이 두 배다
  const { data: existing } = await (db as any)
    .from('rfp_cases').select('id').eq('source_id', sourceId).is('deleted_at', null).maybeSingle()
  if (existing) {
    return NextResponse.json({ case: existing, reused: true }, { status: 200 })
  }

  const { data: kase, error: caseError } = await (db as any)
    .from('rfp_cases')
    .insert({
      org_id: source.org_id,
      source_id: sourceId,
      title: String(source.title ?? '이름을 읽는 중'),
      // 공고에서 온 이름은 사람이 정한 것이 아니다. 분석이 더 정확한 이름을 찾으면 대신한다
      title_confirmed: false,
      doc_class: docClass,
      budget_amount: source.budget_amount,
      stage: 'uploaded',
      created_by: gate.user.id,
    })
    .select('id, title, doc_class, stage')
    .single()
  if (caseError || !kase) {
    return NextResponse.json({ error: '케이스를 만들지 못했습니다' }, { status: 500 })
  }

  // ── 첨부 받아 오기 ──
  const raw = (source.raw ?? {}) as Record<string, unknown>
  const attachments = attachmentsOf(raw).slice(0, MAX_ATTACHMENTS)
  const admin = createAdminClient()

  const saved: string[] = []
  const failed: { name: string; reason: string }[] = []

  for (const att of attachments) {
    const got = await downloadAttachment(att, { maxBytes: MAX_FILE_BYTES })
    if (!got.ok) {
      // 첨부 하나가 안 받아진다고 케이스를 죽이지 않는다 — 사람이 그 파일만 올리면 된다
      failed.push({ name: att.fileName, reason: got.reason })
      continue
    }

    const sha = await sha256Hex(got.bytes)
    const path = filePath(String(source.org_id), String(kase.id), sha)
    try {
      await putBytes(admin as any, path, got.bytes, got.contentType ?? undefined)
    } catch {
      failed.push({ name: got.fileName, reason: 'storage_failed' })
      continue
    }

    const kind = checkKind(got.fileName, got.bytes)
    const role = guessFileRole(got.fileName)
    const { error } = await (admin as any).from('rfp_document_files').insert({
      case_id: kase.id,
      org_id: source.org_id,
      role: role.role,
      original_name: got.fileName,
      storage_path: path,
      source_url: att.url,
      mime: got.contentType,
      format: kind.ok ? kind.kind : null,
      size_bytes: got.bytes.byteLength,
      sha256: sha,
      uploaded_by: gate.user.id,
    })
    // 같은 파일이 두 번 붙어 있으면 유니크가 막는다. 그건 실패가 아니다
    if (error && String((error as { code?: string }).code) !== '23505') {
      failed.push({ name: got.fileName, reason: 'insert_failed' })
      continue
    }
    saved.push(got.fileName)
  }

  // 첨부가 하나도 없으면 분석을 걸지 않는다 — 빈 리포트가 「내용 없음」으로 나온다
  let job: { id: string; status: string } | null = null
  if (saved.length > 0) {
    try {
      const enqueued = await enqueueJob(db as any, {
        orgId: String(source.org_id),
        caseId: String(kase.id),
        jobType: 'parse',
        payload: { requestedBy: gate.user.id, version: 1, from: 'source' },
        priority: JOB_PRIORITY.parse,
        dedupeKey: dedupeKey(String(kase.id), 'parse', 1),
      })
      job = { id: enqueued.id, status: enqueued.status }
    } catch {
      // 분석을 못 걸어도 케이스와 파일은 남는다. 화면에서 다시 걸 수 있다
    }
  }

  // 레이더 목록에서 이 공고를 처리됨으로 바꾼다
  await (db as any).from('rfp_radar_hits')
    .update({ status: 'adopted', case_id: kase.id }).eq('source_id', sourceId)

  return NextResponse.json({
    case: kase,
    // 무엇을 받았고 무엇을 못 받았는지 화면이 그대로 보여 준다
    attached: saved,
    failed,
    job,
  }, { status: 201 })
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    return ((await req.json()) ?? {}) as Record<string, unknown>
  } catch {
    return {}
  }
}
