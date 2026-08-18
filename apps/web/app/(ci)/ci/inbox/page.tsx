// app/(ci)/ci/inbox/page.tsx — R01 수집함 (설계서 §7.2)
import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { listContents, searchContentIds } from '@/lib/ci/queries/contents'
import { listChannelGroups } from '@/lib/ci/queries/channel-groups'
import InboxView from './InboxView'

export const dynamic = 'force-dynamic'

type Tab = 'all' | 'review' | 'failed'

/** 목록 표준 §2-6 (4): 기본 20, 상한 100. 목록 조회는 반드시 limit을 건다. */
const SIZES = [20, 50, 100]
const DEFAULT_SIZE = 20

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string; q?: string; sort?: string; dir?: string
    page?: string; size?: string; topic?: string; platform?: string; format?: string
    group?: string
  }>
}) {
  const supabase = await createClient()
  const user = await getRequestUser()
  if (!user) redirect('/login')

  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const sp = await searchParams
  const tab: Tab = sp.tab === 'review' || sp.tab === 'failed' ? sp.tab : 'all'

  // 탭 배지 건수는 목록과 함께 한 번에 구한다
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const adminClient = createAdminClient() as any
  const { data: topicRows } = await adminClient.from('ci_topics')
    .select('id, name').eq('workspace_id', workspace.id)
    .is('deleted_at', null).is('merged_into_id', null).order('name')

  // 검색·정렬·페이지는 전부 URL이 진실이다(§2-6 (1)).
  // 링크를 공유하면 받는 사람도 같은 화면을 본다.
  const q = typeof sp.q === 'string' ? sp.q.trim() : ''
  const sort = sp.sort === 'outlier' || sp.sort === 'velocity' ? sp.sort : 'recent'
  const size = SIZES.includes(Number(sp.size)) ? Number(sp.size) : DEFAULT_SIZE
  const rawPage = Number(sp.page ?? '1')
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.trunc(rawPage) : 1

  // 채널별 보기는 **페이지 단위가 채널**이다(마이그 214).
  // 게시물로 페이지를 자른 뒤 묶으면 페이지마다 채널이 바뀌어 조망이 불가능하다
  // (사용자 지적 2026-08-18 · 표준: AG Grid 서버사이드 모델).
  const grouped = sp.group === '1'
  const groupSize = grouped ? Math.min(size, 20) : size

  // 그룹 모드에서 검색을 걸면 **검색에 걸린 게시물이 있는 채널만** 나와야 한다.
  const searchIds = grouped && q ? Array.from((await searchContentIds(workspace.id, q)).keys()) : null
  if (grouped && q && (searchIds?.length ?? 0) === 0) {
    // 검색 결과가 0건이면 채널도 0곳이다 — 빈 배열을 넘기면 RPC가 '제한 없음'으로 읽는다
    searchIds!.push('00000000-0000-0000-0000-000000000000')
  }

  const [current, review, failed, channelGroups] = await Promise.all([
    listContents({
      workspaceId: workspace.id, tab, corpusOnly: false, sort,
      limit: size, cursor: String((page - 1) * size), q,
      topicId: sp.topic || null,
      platform: (sp.platform as never) || null,
      format: (sp.format as never) || null,
    }),
    listContents({ workspaceId: workspace.id, tab: 'review', corpusOnly: false, limit: 1 }),
    listContents({ workspaceId: workspace.id, tab: 'failed', corpusOnly: false, limit: 1 }),
    grouped
      ? listChannelGroups({
          workspaceId: workspace.id, tab, contentIds: searchIds,
          topicId: sp.topic || null,
          platform: (sp.platform as never) || null,
          format: (sp.format as never) || null,
          limit: groupSize, offset: (page - 1) * groupSize,
        })
      : Promise.resolve(null),
  ])

  return (
    <InboxView
      workspaceId={workspace.id}
      tab={tab}
      items={current.items}
      total={current.total}
      page={page}
      size={grouped ? groupSize : size}
      groups={channelGroups?.groups ?? null}
      groupTotal={channelGroups?.total ?? 0}
      counts={{ review: review.total, failed: failed.total }}
      topics={(topicRows ?? []) as { id: string; name: string }[]}
    />
  )
}
