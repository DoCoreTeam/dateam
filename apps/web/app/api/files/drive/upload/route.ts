import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureFolder, uploadFile } from '@/lib/google-drive'

const ROOT_FOLDER_NAME = 'AX사업본부'
const BUSINESS_CARD_FOLDER_NAME = '명함'

// 허용 MIME 타입 (이미지 및 PDF)
const ALLOWED_MIME_TYPES: ReadonlyArray<string> = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 인증 확인 — 로그인한 멤버라면 누구나 명함 업로드 가능
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
  }

  // multipart/form-data 파싱
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json(
      { error: '요청 파싱 실패 — multipart/form-data 형식이어야 합니다' },
      { status: 400 }
    )
  }

  const fileEntry = formData.get('file')
  if (!fileEntry || !(fileEntry instanceof File)) {
    return NextResponse.json(
      { error: 'file 필드가 없거나 올바르지 않습니다' },
      { status: 400 }
    )
  }

  const file = fileEntry as File

  // 파일 크기 검증
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `파일 크기는 최대 ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB까지 허용됩니다` },
      { status: 400 }
    )
  }

  // MIME 타입 검증
  const mimeType = file.type || 'application/octet-stream'
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return NextResponse.json(
      { error: `지원하지 않는 파일 형식입니다. 허용: ${ALLOWED_MIME_TYPES.join(', ')}` },
      { status: 400 }
    )
  }

  // 파일명 정리 (경로 순회 공격 방지)
  const rawName = file.name.replace(/[/\\]/g, '_')
  const fileName = rawName || `upload_${Date.now()}`

  try {
    // Buffer 변환
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // 폴더 계층 ensure: AX사업본부 > 명함
    const rootFolderId = await ensureFolder(ROOT_FOLDER_NAME)
    const cardFolderId = await ensureFolder(BUSINESS_CARD_FOLDER_NAME, rootFolderId)

    // Drive 업로드
    const fileId = await uploadFile(buffer, fileName, mimeType, cardFolderId)

    return NextResponse.json({ fileId, fileName }, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
