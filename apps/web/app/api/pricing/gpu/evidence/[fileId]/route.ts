import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { streamFile } from '@/lib/google-drive'

// GPU 견적 원본데이터(Drive) 스트리밍 — 검토대기/확정 견적에 연결된 원본 파일 열람.
// 인증: 관리자(GPU 가격은 admin 영역). IDOR: review_items/supply_quotes에 연결된 fileId만 허용.
const VALID_FILE_ID_RE = /^[A-Za-z0-9_-]+$/

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<NextResponse> {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const { fileId } = await params
  if (!fileId || !VALID_FILE_ID_RE.test(fileId)) {
    return NextResponse.json({ error: '유효하지 않은 fileId입니다' }, { status: 400 })
  }

  // IDOR 차단 — 이 fileId가 실제 GPU 검토/견적에 연결돼 있어야 열람 허용.
  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient as any
  const [rev, quote] = await Promise.all([
    db.from('review_items').select('id').eq('evidence_drive_file_id', fileId).is('deleted_at', null).limit(1).maybeSingle(),
    db.from('supply_quotes').select('id').eq('evidence_drive_file_id', fileId).limit(1).maybeSingle(),
  ])
  if (!rev.data && !quote.data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const { stream, mimeType, fileName } = await streamFile(fileId)
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
        // 민감 견적 원본 — 공유/재사용 캐시 금지(IDOR 검증 우회 방지)
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: unknown) {
    // Drive raw 에러 메시지는 클라이언트에 노출하지 않음(내부 경로/계정/scope 누설 방지). 서버 로그로만.
    console.error('[gpu/evidence] streamFile 실패:', err)
    const code = err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'number'
      ? (err as { code: number }).code
      : 500
    const status = code === 404 || code === 403 ? code : 500
    return NextResponse.json({ error: '원본 파일을 불러오지 못했습니다' }, { status })
  }
}
