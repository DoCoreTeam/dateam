// lib/ci/format/creative-info.ts — 크리에이티브 행 → 표시 형태 변환 SSOT
//
// DB 접근과 분리해 둔 이유: 이 변환이 표시 규칙 그 자체이고, 테스트가 지켜야 할 곳이다.
// (조회는 `lib/ci/queries/creative.ts`, 표시는 `components/ci/CreativeSummary.tsx`)

import { formatKstDateTimeShort } from '../../datetime/kst.ts'
import type { CiCreativeInfo } from '../contracts.ts'

export interface CreativeRow {
  content_id: string
  thumbnail_text: string | null
  thumbnail_style: string[] | null
  thumbnail_summary: string | null
  hook_message: string | null
  hook_type: string | null
  title_pattern: string[] | null
  evidence: Record<string, unknown> | null
  model: string | null
  analyzed_at: string | null
}

/**
 * `source`는 model 유무로 판정한다 — 규칙만으로 낸 결과를
 * AI가 썸네일을 읽은 것처럼 보이게 하지 않는다.
 */
export function toCreativeInfo(row: CreativeRow): CiCreativeInfo {
  const evidence = row.evidence ?? {}
  const rawNote = evidence.note
  const note = typeof rawNote === 'string' && rawNote.trim() ? rawNote : null
  return {
    thumbnailText: row.thumbnail_text,
    thumbnailStyle: row.thumbnail_style ?? [],
    thumbnailSummary: row.thumbnail_summary,
    hookMessage: row.hook_message,
    hookType: row.hook_type,
    titlePattern: row.title_pattern ?? [],
    source: row.model ? 'ai' : 'rules',
    note,
    analyzedAtText: row.analyzed_at ? formatKstDateTimeShort(row.analyzed_at) : null,
  }
}
