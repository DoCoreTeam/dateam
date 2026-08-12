// app/api/ci/notifications/route.ts — 알림함 (설계서 §8.1)
// 알림은 본인 것만 본다. 워크스페이스 멤버라도 남의 알림은 못 읽는다.

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected, readPaging } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CiNotificationItem {
  id: string
  title: string
  body: string | null
  deeplink: string | null
  contentId: string | null
  sentAt: string
  readAt: string | null
}

export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const url = new URL(req.url)
    const { limit } = readPaging(url)

    const adminClient = createAdminClient() as any
    const [{ data: rows }, { count }] = await Promise.all([
      adminClient
        .from('ci_notifications')
        .select('id, title, body, deeplink, content_id, sent_at, read_at')
        .eq('workspace_id', session.workspaceId)
        .eq('user_id', session.userId)
        .order('sent_at', { ascending: false })
        .limit(limit),
      adminClient
        .from('ci_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', session.workspaceId)
        .eq('user_id', session.userId)
        .is('read_at', null),
    ])

    const items: CiNotificationItem[] = ((rows ?? []) as any[]).map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body ?? null,
      deeplink: r.deeplink ?? null,
      contentId: r.content_id ?? null,
      sentAt: r.sent_at,
      readAt: r.read_at ?? null,
    }))

    return ok({ items, unreadCount: count ?? 0 })
  } catch (e) {
    return failUnexpected(e)
  }
}

const Patch = z.object({
  /** 비우면 전부 읽음 처리 */
  ids: z.array(z.string().uuid()).optional(),
})

/** 읽음 처리. 이미 읽은 것은 시각을 덮어쓰지 않는다. */
export async function PATCH(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const parsed = Patch.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return fail('VALIDATION_FAILED', '입력값을 확인해 주세요', parsed.error.issues)

    const adminClient = createAdminClient() as any
    let q = adminClient
      .from('ci_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('workspace_id', session.workspaceId)
      .eq('user_id', session.userId)
      .is('read_at', null)

    if (parsed.data.ids?.length) q = q.in('id', parsed.data.ids)

    const { data } = await q.select('id')
    return ok({ readCount: ((data ?? []) as unknown[]).length })
  } catch (e) {
    return failUnexpected(e)
  }
}
