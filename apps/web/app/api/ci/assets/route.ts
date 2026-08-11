import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { listAssets, ASSETS_PAGE_SIZE } from '@/lib/ci/queries/assets'
import { fetchLinkMeta, isSafeHttpUrl } from '@/lib/ci/assets/link'

/* eslint-disable @typescript-eslint/no-explicit-any */

const LinkBody = z.object({
  sourceKind: z.literal('link'),
  url: z.string().trim().min(1).max(2000),
  title: z.string().trim().max(200).optional(),
  kind: z.enum(['source', 'output']).default('source'),
  briefId: z.string().uuid().nullable().optional(),
})

/** 목록 — 검색 + 커서 페이지네이션. 전량 로드하지 않는다. */
export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const url = new URL(req.url)
    const sourceKindRaw = url.searchParams.get('sourceKind')
    const result = await listAssets({
      workspaceId: session.workspaceId,
      q: url.searchParams.get('q'),
      sourceKind: sourceKindRaw === 'file' || sourceKindRaw === 'link' ? sourceKindRaw : null,
      cursor: url.searchParams.get('cursor'),
      limit: ASSETS_PAGE_SIZE,
    })

    return ok(result.items, { total: result.total, cursor: result.nextCursor })
  } catch (e) {
    return failUnexpected(e)
  }
}

/**
 * 링크 자료 등록.
 * 원본 파일은 받지 않는다 — 주소와 눈에 보이는 메타만 남긴다.
 * (파일 업로드는 `/api/ci/assets/upload`가 드라이브로 처리한다)
 */
export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const parsed = LinkBody.safeParse(await req.json())
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', '링크 정보를 확인해 주세요', parsed.error.issues)
    }
    const url = parsed.data.url.trim()
    if (!isSafeHttpUrl(url)) {
      return fail('VALIDATION_FAILED', 'http/https 주소만 등록할 수 있습니다')
    }

    const adminClient = createAdminClient() as any

    // 같은 워크스페이스에 같은 주소가 이미 있으면 중복으로 쌓지 않는다
    const { data: dup } = await adminClient
      .from('ci_assets').select('id')
      .eq('workspace_id', session.workspaceId).eq('source_url', url)
      .is('deleted_at', null).maybeSingle()
    if (dup?.id) return fail('CONFLICT', '이미 등록된 링크입니다')

    // 메타 확보 실패는 등록을 막지 않는다 — 사유만 함께 남긴다
    const meta = await fetchLinkMeta(url).catch(() => null)

    const { data: asset, error: insErr } = await adminClient.from('ci_assets').insert({
      workspace_id: session.workspaceId,
      brief_id: parsed.data.briefId ?? null,
      kind: parsed.data.kind,
      source_kind: 'link',
      storage_provider: 'external',
      source_url: url,
      title: parsed.data.title?.trim() || meta?.title || null,
      thumbnail_url: meta?.thumbnailUrl ?? null,
      link_meta: meta
        ? {
          providerLabel: meta.providerLabel, platform: meta.platform,
          externalId: meta.externalId, note: meta.note,
        }
        : {},
      created_by: session.userId,
    }).select('id').single()

    if (insErr) return fail('INTERNAL', '자료를 등록하지 못했습니다')

    return ok({
      assetId: asset?.id ?? null,
      title: parsed.data.title?.trim() || meta?.title || url,
      note: meta?.note ?? null,
    })
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
    // 되돌릴 수 있게 소프트 삭제. 드라이브 원본은 건드리지 않는다.
    await adminClient.from('ci_assets')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id).eq('workspace_id', session.workspaceId)
    return ok({ id })
  } catch (e) {
    return failUnexpected(e)
  }
}
