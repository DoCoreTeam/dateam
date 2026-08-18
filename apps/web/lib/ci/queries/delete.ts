// lib/ci/queries/delete.ts — CI 엔티티 삭제 SSOT (서버 전용)
//
// **삭제는 진짜 삭제다.** 목록에서만 감추는 것이 아니라 행을 지운다.
//   사용자 결정(2026-08-16): "삭제는 본연에 가지고 있는 목적이 진짜 삭제야".
//   숨기기는 삭제가 아니다 — 지웠는데 통계에 남아 있으면 그건 거짓말이다.
//   (통계에서만 빼고 싶을 때는 별도 기능인 `is_stat_excluded`가 있다. 둘은 다른 일이다)
//
// 왜 SSOT인가: 지우면 무엇이 함께 사라지는지가 엔티티마다 다르고,
//   그 규칙이 화면·API에 흩어지면 **한 곳만 고쳐 고아 데이터가 남는다.**
//   특히 `ci_board_items`는 폴리모픽(`item_type`+`item_id`)이라 **FK가 없다** —
//   DB가 대신 치워 주지 않으므로 여기서 직접 지워야 한다. 이걸 빠뜨리면
//   보드에 "없는 게시물"이 영원히 남는다.
//
// 권한은 호출부(API 라우트)가 `requireCiMemberApi(workspaceId, 'member')`로 판정한다.
//   CI 워크스페이스 멤버십 기준이라 앱 전역 admin과 무관하다 — 나중에 역할을 넓혀도
//   이 파일은 그대로다.

import { createAdminClient } from '@/lib/supabase/server'
import {
  type CiRelation, type CiRelationParent,
  ownedBy, referencedBy, polymorphicRefs,
} from '../relation-contract.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

export type CiDeletableKind =
  | 'content' | 'channel' | 'board' | 'boardItem'
  | 'idea' | 'brief' | 'editPlan' | 'publication'

/** 지우기 전에 사용자에게 보여줄 영향. 되돌릴 수 없으니 미리 밝힌다. */
export interface DeleteImpact {
  /** 사람이 읽는 대상 이름 */
  label: string | null
  /** 함께 사라지는 것들 — 화면이 그대로 나열한다 */
  cascades: { what: string; count: number }[]
  /** 사라지지 않고 연결만 끊기는 것 */
  detaches: { what: string; count: number }[]
  /** 지울 수 없으면 그 이유 */
  blocked: string | null
}

export interface DeleteResult {
  ok: boolean
  /** 실제로 지운 주 대상 수 (0이면 없었거나 남의 워크스페이스) */
  deleted: number
  errorMessage?: string
  /** 실패 종류 — 라우트가 올바른 상태 코드로 옮긴다 */
  code?: 'VALIDATION_FAILED' | 'INTERNAL'
}

/** id 모양 검사. 이게 없으면 잘못 만든 주소가 DB까지 내려가 **500**이 된다(사용자 입력 문제인데). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isCiId(v: string): boolean { return UUID.test(v) }

async function count(adminClient: any, table: string, col: string, val: string): Promise<number> {
  const { count: n } = await adminClient.from(table).select('id', { count: 'exact', head: true }).eq(col, val)
  return n ?? 0
}

/**
 * 계약(relation-contract.ts)이 선언한 관계를 실제로 세어 확인창 목록을 만든다.
 *
 * 왜 계약에서 뽑나: 예전엔 화면마다 "무엇이 함께 사라지는지"를 손으로 적었다.
 * 그래서 FK를 바꿔도 문구는 그대로였고, **화면이 사실과 다른 말을 했다**
 * (채널 삭제창이 "게시물은 남습니다"라고 안내하던 것이 정확히 그 상태다).
 * 계약에서 뽑으면 그 어긋남이 구조적으로 불가능하다.
 */
async function countRelations(
  adminClient: any,
  parent: CiRelationParent,
  id: string,
  which: 'owns' | 'refs' = 'owns',
): Promise<{ what: string; count: number }[]> {
  const relations: CiRelation[] = which === 'owns' ? ownedBy(parent) : referencedBy(parent)
  const visible = relations.filter((r) => r.countForUser)
  const counted = await Promise.all(visible.map(async (r) => {
    let q = adminClient.from(r.table).select('id', { count: 'exact', head: true }).eq(r.column, id)
    if (r.discriminator) q = q.eq(r.discriminator.column, r.discriminator.value)
    const { count: n } = await q
    return { what: r.label, count: n ?? 0 }
  }))
  return counted.filter((c) => c.count > 0)
}

/** 폴리모픽 보드 항목 수 — FK가 없어 직접 센다. */
async function countBoardRefs(adminClient: any, itemType: string, itemId: string): Promise<number> {
  const { count: n } = await adminClient
    .from('ci_board_items').select('id', { count: 'exact', head: true })
    .eq('item_type', itemType).eq('item_id', itemId)
  return n ?? 0
}

/**
 * 무엇이 사라지는지 미리 센다.
 * 되돌릴 수 없는 일이므로 **누르기 전에** 보여 준다.
 */
export async function previewDelete(
  kind: CiDeletableKind,
  id: string,
  workspaceId: string,
): Promise<DeleteImpact> {
  const empty: DeleteImpact = { label: null, cascades: [], detaches: [], blocked: null }
  if (!id || !workspaceId || !isCiId(id)) return { ...empty, blocked: '대상을 찾을 수 없습니다' }

  const adminClient = createAdminClient() as any

  try {
    if (kind === 'content') {
      const { data } = await adminClient.from('ci_contents')
        .select('id, title, canonical_url').eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
      if (!data) return { ...empty, blocked: '이 워크스페이스에 없는 게시물입니다' }
      const [metrics, boards] = await Promise.all([
        count(adminClient, 'ci_content_metrics', 'content_id', id),
        countBoardRefs(adminClient, 'content', id),
      ])
      return {
        label: data.title || data.canonical_url || '제목 없음',
        cascades: [
          { what: '수집한 지표 기록', count: metrics },
          { what: '분석 결과(배수·백분위·크리에이티브)', count: 1 },
          { what: '보드에 담긴 항목', count: boards },
        ].filter((c) => c.count > 0),
        detaches: [],
        blocked: null,
      }
    }

    if (kind === 'channel') {
      const { data } = await adminClient.from('ci_channels')
        .select('id, display_name').eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
      if (!data) return { ...empty, blocked: '이 워크스페이스에 없는 채널입니다' }
      // 게시물은 **함께 사라진다**(마이그 208에서 CASCADE로 바로잡음).
      // 예전엔 SET NULL이라 "채널 미확인" 게시물이 남았고, 그 게시물은 비교군이 없어
      // 배수가 영원히 안 나오면서 화면과 비용만 갉아먹었다(실측 55건).
      return {
        label: data.display_name ?? '이름 미확인',
        cascades: await countRelations(adminClient, 'channel', id),
        detaches: await countRelations(adminClient, 'channel', id, 'refs'),
        blocked: null,
      }
    }

    if (kind === 'board') {
      const { data } = await adminClient.from('ci_boards')
        .select('id, name').eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
      if (!data) return { ...empty, blocked: '이 워크스페이스에 없는 보드입니다' }
      const items = await count(adminClient, 'ci_board_items', 'board_id', id)
      return {
        label: data.name ?? '이름 없음',
        cascades: [{ what: '보드에 담긴 항목', count: items }].filter((c) => c.count > 0),
        detaches: [],
        blocked: null,
      }
    }

    if (kind === 'idea') {
      const { data } = await adminClient.from('ci_ideas')
        .select('id, title').eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
      if (!data) return { ...empty, blocked: '이 워크스페이스에 없는 아이디어입니다' }
      const briefs = await count(adminClient, 'ci_briefs', 'idea_id', id)
      return {
        label: data.title ?? '제목 없음',
        cascades: [{ what: '이 아이디어로 만든 기획(과 그 편집안)', count: briefs }].filter((c) => c.count > 0),
        detaches: [],
        blocked: null,
      }
    }

    if (kind === 'brief') {
      // ⚠️ ci_briefs에는 title 컬럼이 없다(title_options 배열과 hook이 있다).
      //    사람이 알아보는 값은 hook이라 그것을 라벨로 쓴다.
      const { data } = await adminClient.from('ci_briefs')
        .select('id, hook').eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
      if (!data) return { ...empty, blocked: '이 워크스페이스에 없는 기획입니다' }
      const [plans, pubs] = await Promise.all([
        count(adminClient, 'ci_edit_plans', 'brief_id', id),
        count(adminClient, 'ci_publications', 'brief_id', id),
      ])
      return {
        label: data.hook ?? '제목 없음',
        cascades: [{ what: '편집안', count: plans }].filter((c) => c.count > 0),
        detaches: [{ what: '게시물(남아 있고 기획 연결만 끊깁니다)', count: pubs }].filter((c) => c.count > 0),
        blocked: null,
      }
    }

    if (kind === 'editPlan' || kind === 'publication' || kind === 'boardItem') {
      const table = kind === 'editPlan' ? 'ci_edit_plans'
        : kind === 'publication' ? 'ci_publications' : 'ci_board_items'
      // 보드 항목은 workspace_id가 없다 — 보드를 거쳐 소속을 확인한다
      if (kind === 'boardItem') {
        const { data } = await adminClient.from('ci_board_items')
          .select('id, board_id, ci_boards!inner ( workspace_id )').eq('id', id).maybeSingle()
        const ws = Array.isArray(data?.ci_boards) ? data.ci_boards[0]?.workspace_id : data?.ci_boards?.workspace_id
        if (!data || ws !== workspaceId) return { ...empty, blocked: '이 워크스페이스에 없는 항목입니다' }
        return { label: '보드 항목', cascades: [], detaches: [], blocked: null }
      }
      const { data } = await adminClient.from(table)
        .select('id').eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
      if (!data) return { ...empty, blocked: '이 워크스페이스에 없는 대상입니다' }
      return { label: kind === 'editPlan' ? '편집안' : '게시물', cascades: [], detaches: [], blocked: null }
    }

    return { ...empty, blocked: '지원하지 않는 대상입니다' }
  } catch {
    return { ...empty, blocked: '영향을 확인하지 못했습니다' }
  }
}

/**
 * 진짜로 지운다. **되돌릴 수 없다.**
 *
 * 워크스페이스 조건을 **항상** 함께 건다 — id만으로 지우면 남의 워크스페이스 데이터를
 * 지울 수 있다(서비스 롤이라 RLS가 막아 주지 않는다).
 */
export async function deleteCiEntity(
  kind: CiDeletableKind,
  id: string,
  workspaceId: string,
): Promise<DeleteResult> {
  if (!id || !workspaceId || !isCiId(id)) {
    return { ok: false, deleted: 0, code: 'VALIDATION_FAILED', errorMessage: '대상을 찾을 수 없습니다' }
  }
  const adminClient = createAdminClient() as any

  try {
    if (kind === 'boardItem') {
      // 소속 확인을 먼저 한다(이 테이블엔 workspace_id가 없다)
      const impact = await previewDelete('boardItem', id, workspaceId)
      if (impact.blocked) return { ok: false, deleted: 0, errorMessage: impact.blocked }
      const { data } = await adminClient.from('ci_board_items').delete().eq('id', id).select('id')
      return { ok: true, deleted: (data ?? []).length }
    }

    const table = ({
      content: 'ci_contents', channel: 'ci_channels', board: 'ci_boards',
      idea: 'ci_ideas', brief: 'ci_briefs', editPlan: 'ci_edit_plans', publication: 'ci_publications',
    } as Record<string, string>)[kind]
    if (!table) return { ok: false, deleted: 0, errorMessage: '지원하지 않는 대상입니다' }

    // 폴리모픽 참조(FK를 걸 수 없는 자리)를 본체보다 **먼저** 지운다.
    //
    // 마이그 208의 DB 트리거가 같은 일을 하므로 이건 두 번째 방어선이다. 그래도 남기는 이유:
    //   ⓐ 마이그레이션이 아직 안 간 환경(로컬·새 브랜치)에서도 고아를 만들지 않는다
    //   ⓑ 순서가 중요하다 — 본체를 먼저 지우면 어떤 항목이 고아인지 알 방법이 사라진다
    // 예전엔 여기서 content·idea·brief 3종만 다뤄 **채널이 통째로 빠져 있었다**.
    // 이제 종류를 손으로 적지 않고 계약에서 뽑는다 — 새 참조가 생겨도 자동으로 포함된다.
    for (const rel of polymorphicRefs(kind as CiRelationParent)) {
      await adminClient.from(rel.table).delete()
        .eq(rel.discriminator!.column, rel.discriminator!.value)
        .eq(rel.column, id)
    }

    const { data, error } = await adminClient.from(table).delete()
      .eq('id', id).eq('workspace_id', workspaceId).select('id')

    if (error) return { ok: false, deleted: 0, errorMessage: '지우지 못했습니다' }
    return { ok: true, deleted: (data ?? []).length }
  } catch {
    return { ok: false, deleted: 0, errorMessage: '지우지 못했습니다' }
  }
}
