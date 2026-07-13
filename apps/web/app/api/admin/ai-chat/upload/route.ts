import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import {
  DOCUMENT_OFFICE_MIMES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  SIGNED_URL_TTL_SEC,
  kindOfMime,
  extFromMime,
  sniffMagicBytes,
  maxBytesForMime,
  sanitizeFilenameForDisplay,
  extractDocumentText,
} from '@/lib/ai-chat/attachments'

// officeparser(extractDocumentText) + node:crypto 사용 — Node 런타임 고정
export const runtime = 'nodejs'

const BUCKET = 'ai-chat'

// kind 판정 실패 시 안내 문구(설계 §3-1 확정 문안)
const UNSUPPORTED_MIME_MSG =
  '지원하지 않는 파일 형식입니다 (이미지 png/jpg/webp · PDF · 문서 txt/csv/md/json/docx/xlsx/pptx)'

// 새 테이블(ai_conversations·ai_attachments)은 생성 타입에 아직 없어 branding 라우트와 동일하게 느슨 캐스팅
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminDb = any

interface AttachmentRow {
  id: string
  storage_path: string
}

/**
 * POST /api/admin/ai-chat/upload — 첨부 1개 업로드 (multipart/form-data)
 * Request: file: File, conversationId: string(uuid)
 * Response 200: { attachment: { id, filename, mime, sizeBytes, kind, signedUrl } }
 * 오류: 400 / 401·403 / 404 / 500
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1) 인증·인가
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const user = auth.user

  // 2) formData 파싱
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 })
  }
  const file = form.get('file')
  const conversationId = form.get('conversationId')
  if (!(file instanceof File) || typeof conversationId !== 'string' || !conversationId) {
    return NextResponse.json({ error: 'file 과 conversationId 가 필요합니다' }, { status: 400 })
  }

  const admin = createAdminClient() as AdminDb

  // 3) 대화 소유 검증
  const { data: conv } = await admin
    .from('ai_conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .single()
  if (!conv) {
    return NextResponse.json({ error: '대화를 찾을 수 없습니다' }, { status: 404 })
  }

  // 4) mime/용량 화이트리스트 (SSOT)
  const mime = file.type
  const kind = kindOfMime(mime)
  if (!kind) {
    return NextResponse.json({ error: UNSUPPORTED_MIME_MSG }, { status: 400 })
  }
  const cap = maxBytesForMime(mime)
  const limitMb = Math.floor(cap / (1024 * 1024))
  // 버퍼링 전 file.size로 선차단(DoS 방어 — 초대형 payload를 메모리에 적재하지 않음)
  if (file.size > cap) {
    return NextResponse.json({ error: `파일 크기가 상한(${limitMb}MB)을 초과합니다` }, { status: 400 })
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength <= 0) {
    return NextResponse.json({ error: '빈 파일은 업로드할 수 없습니다' }, { status: 400 })
  }
  if (bytes.byteLength > cap) {
    // arrayBuffer 실제 크기 재검증(belt-and-suspenders — file.size 위조 대비)
    return NextResponse.json({ error: `파일 크기가 상한(${limitMb}MB)을 초과합니다` }, { status: 400 })
  }

  // 5) 메시지당 개수 상한(대기 중 = message_id null) — 무거운 검증(매직바이트/office 추출) 前 load-shed
  const { count: pendingCount } = await admin
    .from('ai_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id)
    .is('message_id', null)
  if ((pendingCount ?? 0) >= MAX_ATTACHMENTS_PER_MESSAGE) {
    return NextResponse.json(
      { error: `메시지당 첨부는 최대 ${MAX_ATTACHMENTS_PER_MESSAGE}개입니다` },
      { status: 400 },
    )
  }

  // 6) 매직바이트 스니핑(mime 위장 차단) — SSOT sniffMagicBytes 단일 경로
  //    (텍스트 계열 UTF-8+NUL 검사도 sniffMagicBytes default 분기가 수행 — 인라인 중복 제거)
  if (!sniffMagicBytes(bytes, mime)) {
    return NextResponse.json({ error: '파일 내용이 형식과 일치하지 않습니다' }, { status: 400 })
  }

  // office 3종은 실제 파싱 가능 여부까지 시추출로 검증
  if ((DOCUMENT_OFFICE_MIMES as readonly string[]).includes(mime)) {
    try {
      await extractDocumentText(bytes, mime)
    } catch {
      return NextResponse.json({ error: '문서에서 텍스트를 추출하지 못했습니다' }, { status: 400 })
    }
  }

  // 6) 메시지당 개수 상한(대기 중 = message_id null)
  const { count: pendingCount } = await admin
    .from('ai_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id)
    .is('message_id', null)
  if ((pendingCount ?? 0) >= MAX_ATTACHMENTS_PER_MESSAGE) {
    return NextResponse.json(
      { error: `메시지당 첨부는 최대 ${MAX_ATTACHMENTS_PER_MESSAGE}개입니다` },
      { status: 400 },
    )
  }

  // 7) id 선생성 + storage_path 확정(원본 파일명은 경로 미사용) → insert
  const id = randomUUID()
  const storagePath = `${user.id}/${conversationId}/${id}.${extFromMime(mime)}`
  const filename = sanitizeFilenameForDisplay(file.name)

  const { error: insertErr } = await admin.from('ai_attachments').insert({
    id,
    message_id: null,
    conversation_id: conversationId,
    user_id: user.id,
    storage_path: storagePath,
    filename,
    mime,
    size_bytes: bytes.byteLength,
    kind,
  })
  if (insertErr) {
    return NextResponse.json({ error: '첨부 저장에 실패했습니다' }, { status: 500 })
  }

  // 8) Storage 업로드 — 실패 시 insert 롤백 후 500
  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: mime, upsert: false })
  if (uploadErr) {
    await admin.from('ai_attachments').delete().eq('id', id)
    return NextResponse.json({ error: '파일 업로드에 실패했습니다' }, { status: 500 })
  }

  // 9) 서명 URL(TTL 1h) — 실패 시 업로드/행 롤백 후 500
  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC)
  if (signErr || !signed?.signedUrl) {
    await admin.storage.from(BUCKET).remove([storagePath])
    await admin.from('ai_attachments').delete().eq('id', id)
    return NextResponse.json({ error: '서명 URL 생성에 실패했습니다' }, { status: 500 })
  }

  // 10) 고아 첨부 정리(best-effort — 실패 무시, 다음 업로드가 재시도)
  await cleanupOrphans(admin, user.id)

  return NextResponse.json({
    attachment: {
      id,
      filename,
      mime,
      sizeBytes: bytes.byteLength,
      kind,
      signedUrl: signed.signedUrl,
    },
  })
}

/**
 * DELETE /api/admin/ai-chat/upload — 전송 전 첨부 취소 (JSON { attachmentId })
 * message_id 가 채워진(전송 완료) 첨부는 삭제 불가(404) — 대화 히스토리 무결성 보존
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const user = auth.user

  let body: { attachmentId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 })
  }
  const attachmentId = body?.attachmentId
  if (typeof attachmentId !== 'string' || !attachmentId) {
    return NextResponse.json({ error: 'attachmentId 가 필요합니다' }, { status: 400 })
  }

  const admin = createAdminClient() as AdminDb

  const { data: row } = await admin
    .from('ai_attachments')
    .select('id, storage_path')
    .eq('id', attachmentId)
    .eq('user_id', user.id)
    .is('message_id', null)
    .single()
  if (!row) {
    return NextResponse.json({ error: '삭제할 첨부를 찾을 수 없습니다' }, { status: 404 })
  }

  const target = row as AttachmentRow
  await admin.storage.from(BUCKET).remove([target.storage_path])
  await admin.from('ai_attachments').delete().eq('id', target.id)

  return NextResponse.json({ ok: true })
}

/** message_id null & 24h 초과 첨부를 Storage·행에서 제거 (best-effort) */
async function cleanupOrphans(admin: AdminDb, userId: string): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data } = await admin
      .from('ai_attachments')
      .select('id, storage_path')
      .eq('user_id', userId)
      .is('message_id', null)
      .lt('created_at', cutoff)
      .limit(100)
    const orphans = (data ?? []) as AttachmentRow[]
    if (orphans.length === 0) return
    await admin.storage.from(BUCKET).remove(orphans.map((o) => o.storage_path))
    await admin
      .from('ai_attachments')
      .delete()
      .in('id', orphans.map((o) => o.id))
  } catch {
    // best-effort — 실패 무시
  }
}
