import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import {
  DOCUMENT_OFFICE_MIMES,
  sniffMagicBytes,
  sanitizeFilenameForDisplay,
  extractDocumentText,
} from '@/lib/ai-chat/attachments'
import { addKnowledgeText } from '@/app/admin/ai-chat/actions'

// officeparser(extractDocumentText/PDF 추출) + Buffer 사용 — Node 런타임 고정
export const runtime = 'nodejs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminDb = any

// 허용 타입·상한 (04 §6-1): 텍스트 계열 ≤1MB · office/pdf ≤10MB
const TEXT_MIMES = ['text/plain', 'text/markdown', 'text/csv'] as const
const PDF_MIME = 'application/pdf'
const TEXT_MAX_BYTES = 1 * 1024 * 1024
const BINARY_MAX_BYTES = 10 * 1024 * 1024
const PDF_PARSE_TIMEOUT_MS = 15_000 // zip/pdf 파싱 DoS 방어 하드 타임아웃

const UNSUPPORTED_MSG =
  '지원하지 않는 파일 형식입니다 (텍스트 txt/md/csv · 문서 docx/xlsx/pptx · pdf)'

// PDF 텍스트 추출 — extractDocumentText는 텍스트/office만 라우팅하므로(pdf 미지원)
// officeparser(parseOffice, pdf 지원)를 직접 호출한다. 추출 실패 시 throw.
async function extractPdfText(buf: Uint8Array): Promise<string> {
  const { parseOffice } = await import('officeparser')
  return await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('pdf extract timeout')), PDF_PARSE_TIMEOUT_MS)
    ;(async () => {
      const ast = await parseOffice(Buffer.from(buf))
      const out = await ast.to('md')
      return typeof out?.value === 'string' ? out.value : String(out?.value ?? '')
    })().then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/**
 * POST /api/admin/ai-chat/knowledge-upload — 프로젝트 지식 파일 업로드 (multipart/form-data)
 * Request: file: File, projectId: string(uuid)
 * 텍스트 추출 → addKnowledgeText 위임(청크→임베딩→저장). URL fetch 없음(SSRF 차단).
 * Response 200: { ok:true, chunks, embedded } · 오류: { ok:false, error } 400/401/403/404
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const user = auth.user

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, error: '잘못된 요청 형식입니다' }, { status: 400 })
  }
  const file = form.get('file')
  const projectId = form.get('projectId')
  if (!(file instanceof File) || typeof projectId !== 'string' || !projectId) {
    return NextResponse.json({ ok: false, error: 'file 과 projectId 가 필요합니다' }, { status: 400 })
  }

  const admin = createAdminClient() as AdminDb

  // 프로젝트 소유 검증 (admin + owner)
  const { data: proj } = await admin
    .from('ai_projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .single()
  if (!proj) {
    return NextResponse.json({ ok: false, error: '프로젝트를 찾을 수 없습니다' }, { status: 404 })
  }

  // 타입·용량 화이트리스트
  const mime = file.type
  const isText = (TEXT_MIMES as readonly string[]).includes(mime)
  const isOffice = (DOCUMENT_OFFICE_MIMES as readonly string[]).includes(mime)
  const isPdf = mime === PDF_MIME
  if (!isText && !isOffice && !isPdf) {
    return NextResponse.json({ ok: false, error: UNSUPPORTED_MSG }, { status: 400 })
  }
  const cap = isText ? TEXT_MAX_BYTES : BINARY_MAX_BYTES
  const limitMb = Math.floor(cap / (1024 * 1024))
  // 버퍼링 전 file.size 선차단(DoS 방어)
  if (file.size > cap) {
    return NextResponse.json(
      { ok: false, error: `파일 크기가 상한(${limitMb}MB)을 초과합니다` },
      { status: 400 },
    )
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength <= 0) {
    return NextResponse.json({ ok: false, error: '빈 파일은 업로드할 수 없습니다' }, { status: 400 })
  }
  if (bytes.byteLength > cap) {
    // arrayBuffer 실제 크기 재검증(file.size 위조 대비)
    return NextResponse.json(
      { ok: false, error: `파일 크기가 상한(${limitMb}MB)을 초과합니다` },
      { status: 400 },
    )
  }

  // 매직바이트 스니핑(mime 위장 차단 — SSOT sniffMagicBytes)
  if (!sniffMagicBytes(bytes, mime)) {
    return NextResponse.json(
      { ok: false, error: '파일 내용이 형식과 일치하지 않습니다' },
      { status: 400 },
    )
  }

  // 텍스트 추출: 텍스트/office = extractDocumentText 재사용, pdf = officeparser 직접
  let text: string
  try {
    text = isPdf ? await extractPdfText(bytes) : await extractDocumentText(bytes, mime)
  } catch {
    return NextResponse.json(
      { ok: false, error: '문서에서 텍스트를 추출하지 못했습니다' },
      { status: 400 },
    )
  }
  if (!text.trim()) {
    return NextResponse.json(
      { ok: false, error: '문서에서 텍스트를 추출하지 못했습니다' },
      { status: 400 },
    )
  }

  // addKnowledgeText 위임(청크→임베딩→저장) — 내부에서 소유 재검증(이중 방어)
  const source = sanitizeFilenameForDisplay(file.name) || 'upload'
  const result = await addKnowledgeText(projectId, text, source)
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? '지식 저장에 실패했습니다' },
      { status: 400 },
    )
  }

  return NextResponse.json({ ok: true, chunks: result.chunks, embedded: result.embedded })
}
