import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { streamFile } from '@/lib/google-drive'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 드라이브에 있는 자료를 내려준다.
 *
 * IDOR 차단: 드라이브 파일 ID를 직접 받지 않는다. 우리 자료 id로만 접근을 허용하고,
 * 그 자료가 **요청자의 워크스페이스 것인지** 확인한 뒤에야 드라이브를 읽는다.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const { id } = await ctx.params
    const adminClient = createAdminClient() as any
    const { data: asset } = await adminClient
      .from('ci_assets')
      .select('drive_file_id, title, mime')
      .eq('id', id).eq('workspace_id', session.workspaceId).is('deleted_at', null)
      .maybeSingle()

    if (!asset?.drive_file_id) return fail('NOT_FOUND', '자료를 찾을 수 없습니다')

    // 구간 요청을 그대로 넘긴다. 이게 있어야 <video>가 탐색(seek)을 하고,
    // 편집점 분석이 큰 영상에서도 성립한다(전체 내려받기 없이 프레임만 훑는다).
    const range = req.headers.get('range')
    let opened: Awaited<ReturnType<typeof streamFile>>
    try {
      opened = await streamFile(asset.drive_file_id, range)
    } catch (e) {
      // 드라이브가 못 읽는 이유는 대개 "연결된 계정에 권한이 없다" 또는 "원본이 지워졌다"다.
      // 일반 오류로 뭉개면 사용자가 무엇을 고쳐야 할지 알 수 없다.
      const detail = e instanceof Error ? e.message : ''
      return fail(
        'NOT_FOUND',
        `드라이브에서 원본을 읽지 못했습니다. 파일이 지워졌거나 연결된 계정에 접근 권한이 없습니다${detail ? ` (${detail.slice(0, 120)})` : ''}`,
      )
    }
    const { stream, mimeType, fileName, size, contentRange, partial } = opened

    // Node Readable → Web ReadableStream
    const webStream = new ReadableStream<Uint8Array>({
      start(controller) {
        stream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
        stream.on('end', () => controller.close())
        stream.on('error', (err: Error) => controller.error(err))
      },
      cancel() { stream.destroy() },
    })

    const headers: Record<string, string> = {
      'Content-Type': asset.mime ?? mimeType,
      'Content-Disposition':
        `inline; filename*=UTF-8''${encodeURIComponent(asset.title ?? fileName)}`,
      // 원본은 바뀌지 않으므로 브라우저 캐시를 길게 준다(비공개)
      'Cache-Control': 'private, max-age=3600',
      // 이 헤더가 없으면 브라우저는 구간 요청을 아예 시도하지 않는다
      'Accept-Ranges': 'bytes',
    }
    if (contentRange) headers['Content-Range'] = contentRange
    else if (size != null) headers['Content-Length'] = String(size)

    return new NextResponse(webStream, { status: partial ? 206 : 200, headers })
  } catch (e) {
    return failUnexpected(e)
  }
}
