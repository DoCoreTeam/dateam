// lib/ci/queries/discovery-evidence.ts — 발견의 **근거**를 읽는 단일 구현(SSOT)
//
// 왜 이 파일이 필요한가(2026-08-27 실측):
//   마이그 222 가 `ci_discovery_evidence` 를 만들면서 주석에 이렇게 적어 두었다 —
//   "이 콘텐츠에서 무엇을 보고 그렇게 말했는지. **근거를 눌렀을 때 보여 준다**".
//   그런데 운영 DB 에 근거 43건(observation 43건 전부 채워짐)이 쌓이는 동안
//   **읽는 코드는 0건**이었다. 쓰기만 있고(`jobs/stages.ts`) 읽기가 없어서
//   화면은 "근거 7건 · 채널 4곳"이라는 **숫자만** 보여주고 그 7건을 열 수 없었다.
//   (사용자 지적: "도대체 인사이트가 정확히 나온다고 안 보여, 상세를 눌러도 인사이트가 안 보이고")
//
// 방향은 둘이고 **같은 표를 반대로 읽는 것**이라 한 파일에 둔다:
//   ① 발견 → 근거들      (성공 공식 행을 눌렀을 때)   getDiscoveryEvidence
//   ② 게시물 → 발견들    (콘텐츠 상세를 열었을 때)    getDiscoveriesForContent
//        └ 인덱스 `idx_ci_discovery_evidence_content` 가 ②를 위해 이미 만들어져 있었다.

import { createAdminClient } from '@/lib/supabase/server'
import { formatDiscoveryBasis } from '@/lib/ci/analysis/discovery'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 발견 하나가 어떤 게시물을 근거로 삼았는지 — 한 건 */
export interface DiscoveryEvidenceItem {
  contentId: string
  title: string | null
  channelName: string | null
  thumbnailUrl: string | null
  canonicalUrl: string | null
  /** "잘된 것의 제목은 …인 반면, 평범한 3건은 …" — AI 가 그렇게 본 이유 */
  observation: string | null
}

/** 성공 공식 행을 눌렀을 때 여는 것 */
export interface DiscoveryEvidence {
  id: string
  statement: string
  /** "근거 7건 · 채널 4곳" — 목록과 **같은 문장**을 쓴다(숫자를 두 벌로 만들지 않는다) */
  basisText: string
  topicName: string | null
  items: DiscoveryEvidenceItem[]
}

/** 콘텐츠 상세에서 "이 게시물은 무엇의 근거였나"를 말하는 데 필요한 것 */
export interface ContentDiscoveryRef {
  id: string
  statement: string
  basisText: string
  observation: string | null
}

/** 근거로 딸려 오는 게시물 수 상한 — 시트 하나가 감당할 분량 */
const MAX_EVIDENCE_ITEMS = 50
/** 한 게시물이 근거가 된 발견 수 상한 — 상세 상단이 목록이 되지 않게 */
const MAX_REFS_PER_CONTENT = 5

/**
 * ① 발견 → 그 발견이 근거로 삼은 게시물들.
 *
 * 워크스페이스를 발견 쪽에서 검사한다 — 근거 표에는 workspace_id 가 없고
 * 부모(`ci_discoveries`)가 그것을 가진다. 남의 워크스페이스 발견 id 를 넣으면 null 이다.
 */
export async function getDiscoveryEvidence(
  workspaceId: string,
  discoveryId: string,
): Promise<DiscoveryEvidence | null> {
  const db = createAdminClient() as any

  const { data: d } = await db
    .from('ci_discoveries')
    .select('id, statement, evidence_count, channel_count, ci_topics ( name )')
    .eq('id', discoveryId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!d) return null

  const { data: rows } = await db
    .from('ci_discovery_evidence')
    .select('content_id, observation, ci_contents ( id, title, thumbnail_url, canonical_url, ci_channels ( display_name ) )')
    .eq('discovery_id', discoveryId)
    .limit(MAX_EVIDENCE_ITEMS)

  const items: DiscoveryEvidenceItem[] = (rows ?? [])
    // 게시물이 지워졌으면 근거도 따라 사라진다(FK CASCADE). 조인이 비는 건 방어용이다.
    .filter((r: any) => r.ci_contents)
    .map((r: any) => ({
      contentId: r.content_id,
      title: r.ci_contents.title ?? null,
      channelName: r.ci_contents.ci_channels?.display_name ?? null,
      thumbnailUrl: r.ci_contents.thumbnail_url ?? null,
      canonicalUrl: r.ci_contents.canonical_url ?? null,
      observation: r.observation ?? null,
    }))

  return {
    id: d.id,
    statement: d.statement,
    basisText: formatDiscoveryBasis(d.evidence_count ?? 0, d.channel_count ?? 0),
    topicName: d.ci_topics?.name ?? null,
    items,
  }
}

/**
 * ② 게시물 → 이 게시물을 근거로 삼은 살아 있는 발견들.
 *
 * 상세를 열었을 때 **맨 먼저** 보여줄 것이다. 예전 상세는 조회수·유튜브 원본 키워드·
 * 설명란 원문만 보여줘서 "원본 데이터 덤프"였다 — 왜 이게 잘됐는지는 한 줄도 없었다.
 */
export async function getDiscoveriesForContent(
  workspaceId: string,
  contentId: string,
): Promise<ContentDiscoveryRef[]> {
  const db = createAdminClient() as any

  const { data: rows } = await db
    .from('ci_discovery_evidence')
    .select('observation, ci_discoveries!inner ( id, statement, evidence_count, channel_count, workspace_id, is_archived )')
    .eq('content_id', contentId)
    // 보관된 발견은 더 이상 우리 주장이 아니다 — 화면에서 되살리지 않는다
    .eq('ci_discoveries.is_archived', false)
    .eq('ci_discoveries.workspace_id', workspaceId)
    .limit(MAX_REFS_PER_CONTENT)

  return (rows ?? []).map((r: any) => ({
    id: r.ci_discoveries.id,
    statement: r.ci_discoveries.statement,
    basisText: formatDiscoveryBasis(
      r.ci_discoveries.evidence_count ?? 0,
      r.ci_discoveries.channel_count ?? 0,
    ),
    observation: r.observation ?? null,
  }))
}
