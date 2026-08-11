import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { resolveStorageTarget, putFile } from '@/lib/ci/assets/storage'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 서버 메모리를 통과하므로 상한을 둔다. 큰 영상은 드라이브에 직접 올리고 링크로 등록하는 게 맞다. */
const MAX_BYTES = 100 * 1024 * 1024

export const maxDuration = 60

/**
 * 파일 자료 등록 — 원본은 **구글드라이브**에 둔다.
 * 우리 서버(Supabase Storage)에 쌓지 않는다: 용량이 곧 서비스 한계가 되기 때문이다.
 */
export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return fail('VALIDATION_FAILED', '파일 형식(multipart/form-data)이 아닙니다')
    }

    const entry = form.get('file')
    if (!(entry instanceof File)) return fail('VALIDATION_FAILED', '파일이 없습니다')
    if (entry.size > MAX_BYTES) {
      return fail(
        'VALIDATION_FAILED',
        `파일은 ${MAX_BYTES / 1024 / 1024}MB까지 올릴 수 있습니다. 더 큰 영상은 드라이브에 직접 올린 뒤 링크로 등록해 주세요`,
      )
    }

    const adminClient = createAdminClient() as any
    const { data: ws } = await adminClient
      .from('ci_workspaces').select('name').eq('id', session.workspaceId).maybeSingle()

    const target = await resolveStorageTarget(ws?.name ?? '기본')
    if (!target.ok) return fail('INTERNAL', target.reason)

    // 경로 순회 방지 + 표시용 원본명 보존
    const fileName = (entry.name || `upload_${Date.now()}`).replace(/[/\\]/g, '_')
    const mime = entry.type || 'application/octet-stream'

    let driveFileId: string
    try {
      const buffer = Buffer.from(await entry.arrayBuffer())
      driveFileId = await putFile({ buffer, fileName, mime, folderId: target.folderId })
    } catch (e) {
      return fail('INTERNAL', e instanceof Error ? e.message : '드라이브에 올리지 못했습니다')
    }

    const kindRaw = form.get('kind')
    const kind = kindRaw === 'output' ? 'output' : 'source'

    const { data: asset, error: insErr } = await adminClient.from('ci_assets').insert({
      workspace_id: session.workspaceId,
      kind,
      source_kind: 'file',
      storage_provider: 'drive',
      drive_file_id: driveFileId,
      title: fileName,
      mime,
      bytes: entry.size,
      created_by: session.userId,
    }).select('id').single()

    if (insErr) return fail('INTERNAL', '드라이브에는 올라갔지만 자료 등록에 실패했습니다')

    return ok({ assetId: asset?.id ?? null, driveFileId, fileName })
  } catch (e) {
    return failUnexpected(e)
  }
}
