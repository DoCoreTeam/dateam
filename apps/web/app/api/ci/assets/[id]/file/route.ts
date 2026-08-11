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

    const { stream, mimeType, fileName } = await streamFile(asset.drive_file_id)

    // Node Readable → Web ReadableStream
    const webStream = new ReadableStream<Uint8Array>({
      start(controller) {
        stream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
        stream.on('end', () => controller.close())
        stream.on('error', (err: Error) => controller.error(err))
      },
      cancel() { stream.destroy() },
    })

    return new NextResponse(webStream, {
      headers: {
        'Content-Type': asset.mime ?? mimeType,
        'Content-Disposition':
          `inline; filename*=UTF-8''${encodeURIComponent(asset.title ?? fileName)}`,
        // 원본은 바뀌지 않으므로 브라우저 캐시를 길게 준다(비공개)
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (e) {
    return failUnexpected(e)
  }
}
