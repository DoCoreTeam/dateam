// lib/ci/queries/ideas.ts — 제작 파이프라인 조회 (서버 전용)

import { createAdminClient } from '@/lib/supabase/server'
import type { CiIdeaCard } from '../contracts.ts'
import type { CiPipelineStage, CiPlatform } from '../types.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

const EVIDENCE_LABEL: Record<string, string> = {
  content: '떡상',
  pattern: '공식',
  signal: '이슈',
}

/**
 * 근거 배지 문구. "떡상 3건, 공식 1건" 형태(설계서 §7.5).
 * 근거가 없으면 null — 배지를 비워둔다. 없는 근거를 있는 것처럼 쓰지 않는다.
 */
export function buildEvidenceBadge(sourceTypes: readonly string[]): string | null {
  if (sourceTypes.length === 0) return null
  const counts = new Map<string, number>()
  for (const t of sourceTypes) counts.set(t, (counts.get(t) ?? 0) + 1)
  const parts: string[] = []
  for (const key of ['content', 'pattern', 'signal']) {
    const n = counts.get(key)
    if (n) parts.push(`${EVIDENCE_LABEL[key]} ${n}건`)
  }
  return parts.length > 0 ? parts.join(', ') : null
}

export function daysSince(iso: string | null): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((Date.now() - t) / 86400_000))
}

interface Row {
  id: string
  title: string
  stage: CiPipelineStage
  target_platforms: CiPlatform[] | null
  stage_changed_at: string | null
  ci_idea_evidence: { source_type: string }[] | null
}

export async function listIdeas(workspaceId: string): Promise<CiIdeaCard[]> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_ideas')
    .select('id, title, stage, target_platforms, stage_changed_at, ci_idea_evidence ( source_type )')
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .order('stage_changed_at', { ascending: false })

  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    title: r.title,
    stage: r.stage,
    evidenceBadge: buildEvidenceBadge((r.ci_idea_evidence ?? []).map((e) => e.source_type)),
    targetPlatforms: r.target_platforms ?? [],
    daysInStage: daysSince(r.stage_changed_at),
  }))
}
