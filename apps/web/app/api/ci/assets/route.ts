import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'

/* eslint-disable @typescript-eslint/no-explicit-any */

const BUCKET = 'ci-assets'

const Body = z.object({
  fileName: z.string().trim().min(1).max(200),
  mime: z.string().max(120).optional(),
  bytes: z.number().int().nonnegative().optional(),
  kind: z.enum(['source', 'output']).default('source'),
  briefId: z.string().uuid().nullable().optional(),
})

/** 업로드용 서명 URL 발급 + 자료 행 생성. */
export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '파일 정보를 확인해 주세요', parsed.error.issues)

    const safeName = parsed.data.fileName.replace(/[^\w.\-가-힣 ]/g, '_')
    const path = `${session.workspaceId}/${Date.now()}_${safeName}`
    const adminClient = createAdminClient() as any

    const { data: signed, error: signErr } = await adminClient.storage
      .from(BUCKET).createSignedUploadUrl(path)

    if (signErr || !signed) {
      return fail('INTERNAL', '업로드 경로를 만들지 못했습니다. 저장소 버킷(ci-assets)이 있는지 확인해 주세요')
    }

    const { data: asset } = await adminClient.from('ci_assets').insert({
      workspace_id: session.workspaceId,
      brief_id: parsed.data.briefId ?? null,
      kind: parsed.data.kind,
      storage_path: path,
      mime: parsed.data.mime ?? null,
      bytes: parsed.data.bytes ?? null,
      created_by: session.userId,
    }).select('id').single()

    return ok({ assetId: asset?.id ?? null, path, token: signed.token, bucket: BUCKET })
  } catch (e) {
    return failUnexpected(e)
  }
}

export async function DELETE(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return fail('VALIDATION_FAILED', 'id가 필요합니다')
    const adminClient = createAdminClient() as any
    await adminClient.from('ci_assets')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id).eq('workspace_id', session.workspaceId)
    return ok({ id })
  } catch (e) {
    return failUnexpected(e)
  }
}
