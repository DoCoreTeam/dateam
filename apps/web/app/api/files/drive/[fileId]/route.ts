import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamFile } from '@/lib/google-drive'

// fileId 유효성 검사 — Google Drive ID는 영문, 숫자, -, _ 조합
const VALID_FILE_ID_RE = /^[A-Za-z0-9_-]+$/

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
): Promise<NextResponse> {
  // 인증 확인
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
  }

  const { fileId } = await params

  // fileId 형식 검증 (경로 순회 방지)
  if (!fileId || !VALID_FILE_ID_RE.test(fileId)) {
    return NextResponse.json({ error: '유효하지 않은 fileId입니다' }, { status: 400 })
  }

  // IDOR 차단: contacts 테이블에서 해당 fileId를 가진 레코드 존재 여부 확인
  // RLS가 admin은 전체, 멤버는 자신의 contacts만 조회하도록 자동 처리
  const { data: contactRecord } = await supabase
    .from('contacts')
    .select('id')
    .eq('business_card_drive_id', fileId)
    .limit(1)
    .maybeSingle()

  if (!contactRecord) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const { stream, mimeType, fileName } = await streamFile(fileId)

    // Node.js Readable → Web ReadableStream 변환
    const webStream = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk: Buffer) => controller.enqueue(chunk))
        stream.on('end', () => controller.close())
        stream.on('error', (err: Error) => controller.error(err))
      },
    })

    const encodedName = encodeURIComponent(fileName)

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `inline; filename*=UTF-8''${encodedName}`,
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '파일을 불러오는 중 오류가 발생했습니다'

    // Drive API 에러에서 상태 코드 추출 시도
    const statusCode = extractDriveErrorStatus(err)
    return NextResponse.json({ error: message }, { status: statusCode })
  }
}

function extractDriveErrorStatus(err: unknown): number {
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'number'
  ) {
    const code = (err as { code: number }).code
    if (code === 404) return 404
    if (code === 403) return 403
  }
  return 500
}
