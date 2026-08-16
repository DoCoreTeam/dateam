// lib/ci/queries/boards.ts — 보드와 담긴 항목 조회 (서버 전용)
//
// 왜 생겼나: 보드에 담기는 되는데 **담긴 것을 볼 화면이 없었다.**
//   목록은 "담긴 항목 3건"이라고만 말하고 열 수가 없어, 잘못 담은 것을 뺄 방법도 없었다.
//   (근거: docs/2026-08-16-ci-crud-audit/AUDIT.md)
//
// 담긴 항목은 폴리모픽이다(`item_type` + `item_id`, FK 없음).
// 그래서 종류별로 원본을 따로 읽어 붙인다 — 조인이 안 된다.
// 원본이 사라진 항목은 **숨기지 않고 그대로 보여 준다**. 숨기면 "왜 3건인데 2건만 보이지"가 된다.

import { createAdminClient } from '@/lib/supabase/server'
import type { BoardDetail } from '../board-item.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

export type { BoardItem, BoardDetail } from '../board-item.ts'
export { boardItemTypeLabel } from '../board-item.ts'

export async function getBoard(workspaceId: string, boardId: string): Promise<BoardDetail | null> {
  if (!workspaceId || !boardId) return null
  const adminClient = createAdminClient() as any

  const { data: board } = await adminClient
    .from('ci_boards').select('id, name')
    .eq('id', boardId).eq('workspace_id', workspaceId).is('deleted_at', null).maybeSingle()
  if (!board) return null

  const { data: rows } = await adminClient
    .from('ci_board_items').select('id, item_type, item_id, note, added_at')
    .eq('board_id', boardId).order('added_at', { ascending: false }).limit(200)

  const items = (rows ?? []) as { id: string; item_type: string; item_id: string; note: string | null; added_at: string | null }[]
  const byType = (t: string) => items.filter((r) => r.item_type === t).map((r) => r.item_id)

  // 종류별로 한 번씩만 읽는다 — 항목마다 조회하면 N+1이 된다
  const [contents, patterns, signals] = await Promise.all([
    byType('content').length
      ? adminClient.from('ci_contents').select('id, title, canonical_url').in('id', byType('content'))
      : Promise.resolve({ data: [] }),
    byType('pattern').length
      ? adminClient.from('ci_patterns').select('id, statement').in('id', byType('pattern'))
      : Promise.resolve({ data: [] }),
    byType('signal').length
      ? adminClient.from('ci_signals').select('id, title, url').in('id', byType('signal'))
      : Promise.resolve({ data: [] }),
  ])

  const map = new Map<string, { label: string | null; href: string | null }>()
  for (const c of ((contents as any).data ?? []) as any[]) {
    map.set(c.id, { label: c.title || c.canonical_url || '제목 없음', href: `/ci/inbox?content=${c.id}` })
  }
  for (const p of ((patterns as any).data ?? []) as any[]) {
    map.set(p.id, { label: p.statement ?? '공식', href: '/ci/trends?tab=patterns' })
  }
  for (const s of ((signals as any).data ?? []) as any[]) {
    map.set(s.id, { label: s.title ?? '이슈', href: s.url ?? '/ci/trends?tab=signals' })
  }

  return {
    id: board.id,
    name: board.name,
    items: items.map((r) => ({
      id: r.id,
      itemType: r.item_type,
      itemId: r.item_id,
      note: r.note,
      addedAt: r.added_at,
      label: map.get(r.item_id)?.label ?? null,
      href: map.get(r.item_id)?.href ?? null,
    })),
  }
}
