// POST /api/rfp/cases/[id]/files — 첨부 올리기
//
// 순서가 규칙이다: **크기를 먼저 보고, 그다음에 바이트를 읽는다.**
// 200MB 를 메모리에 올린 뒤 거절하면 거절 한 번에 200MB 를 쓴다.
//
// 같은 내용을 다시 올리면 막되 버리지 않는다 — 기존 파일 ID 를 돌려준다.
// 「이미 있음」이라고만 하면 사용자는 자기가 뭘 잘못했는지 모른다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { checkFileSize, sha256Hex, findDuplicate, MAX_FILE_BYTES } from '@/lib/rfp/db/files'
import { guessFileRole } from '@/lib/rfp/parse/role'
import { checkKind } from '@/lib/rfp/parse/quality'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const { id: caseId } = await ctx.params
  const db = await createClient()

  // 케이스가 안 보이면 없는 것이다 — RLS 가 남의 조직 것을 아예 안 준다
  const { data: kase } = await (db as any)
    .from('rfp_cases')
    .select('id, org_id, doc_class')
    .eq('id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!kase) return NextResponse.json({ error: '케이스를 찾지 못했습니다' }, { status: 404 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 })
  }

  const { data: existing } = await (db as any)
    .from('rfp_document_files')
    .select('id, original_name, sha256, size_bytes')
    .eq('case_id', caseId)
    .is('deleted_at', null)

  const caseBytes = (existing ?? []).reduce(
    (n: number, f: { size_bytes: number | null }) => n + (f.size_bytes ?? 0), 0)

  // 바이트를 읽기 전에 크기부터 본다
  const size = checkFileSize({ sizeBytes: file.size, caseBytes, fileName: file.name })
  if (!size.ok) {
    return NextResponse.json(
      { error: size.reason, limit: size.limit, actual: size.actual },
      { status: size.reason === 'file_too_large' || size.reason === 'case_quota_exceeded' ? 413 : 400 },
    )
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const sha = await sha256Hex(bytes)

  const dupe = findDuplicate(sha, (existing ?? []).map((f: { id: string; original_name: string; sha256: string }) => ({
    id: f.id, originalName: f.original_name, sha256: f.sha256,
  })))
  if (dupe.duplicate) {
    return NextResponse.json(
      { error: 'duplicate_file', existingFileId: dupe.existing.id, existingName: dupe.existing.originalName },
      { status: 409 },
    )
  }

  const kind = checkKind(file.name, bytes)
  const role = guessFileRole(file.name)

  const { data, error } = await (db as any)
    .from('rfp_document_files')
    .insert({
      case_id: caseId,
      org_id: kase.org_id,
      role: role.role,
      original_name: file.name,
      mime: file.type || null,
      format: kind.ok ? kind.kind : null,
      size_bytes: file.size,
      sha256: sha,
      uploaded_by: gate.user.id,
    })
    .select('id, original_name, role, size_bytes, sha256, format')
    .single()

  if (error) {
    // 유니크 인덱스가 같은 판단을 한다 — 두 요청이 동시에 오면 여기서 잡힌다
    if (String(error.code) === '23505') {
      return NextResponse.json({ error: 'duplicate_file' }, { status: 409 })
    }
    return NextResponse.json({ error: '파일을 등록하지 못했습니다' }, { status: 500 })
  }

  return NextResponse.json({
    file: data,
    roleGuess: role,
    kindMismatch: kind.ok ? null : { declared: kind.declared, actual: kind.actual },
    maxFileBytes: MAX_FILE_BYTES,
  }, { status: 201 })
}
