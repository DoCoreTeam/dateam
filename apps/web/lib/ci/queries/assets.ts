// lib/ci/queries/assets.ts — 자료 목록 조회 (서버 전용)
//
// 성능 규약: 목록은 **절대 전량 로드하지 않는다.** 커서 페이지네이션으로 한 장씩 준다.
// (자료는 쌓이기만 하는 데이터다 — 전량 렌더는 시간이 지날수록 반드시 느려진다)

import { createAdminClient } from '@/lib/supabase/server'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 한 번에 가져올 자료 수. 카드 그리드 한 화면 + 여유. */
export const ASSETS_PAGE_SIZE = 24

export interface CiAssetItem {
  id: string
  title: string
  kind: string
  sourceKind: 'file' | 'link'
  storageProvider: 'supabase' | 'drive' | 'external'
  sourceUrl: string | null
  thumbnailUrl: string | null
  providerLabel: string | null
  mime: string | null
  /** 서버가 완성한 표기. 클라이언트가 다시 계산하지 않는다 */
  sizeText: string | null
  createdAtText: string
  /** 원본을 여는 주소(링크면 원본, 파일이면 우리 스트리밍 경로) */
  openUrl: string | null
}

interface Row {
  id: string
  title: string | null
  kind: string
  source_kind: 'file' | 'link'
  storage_provider: 'supabase' | 'drive' | 'external'
  source_url: string | null
  thumbnail_url: string | null
  storage_path: string | null
  drive_file_id: string | null
  link_meta: Record<string, unknown> | null
  mime: string | null
  bytes: number | null
  created_at: string
}

/** 바이트 표기. 없으면 null — 0으로 위장하지 않는다. */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null
  if (bytes < 1024) return `${bytes}B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}${units[unit]}`
}

/** 표시명. 제목이 없으면 파일명, 그것도 없으면 주소에서 뽑는다. */
export function displayTitle(row: Pick<Row, 'title' | 'storage_path' | 'source_url'>): string {
  if (row.title?.trim()) return row.title.trim()
  if (row.storage_path) return row.storage_path.split('/').pop() ?? row.storage_path
  if (row.source_url) {
    try {
      const u = new URL(row.source_url)
      return `${u.host.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`
    } catch {
      return row.source_url
    }
  }
  return '이름 없는 자료'
}

export function toAssetItem(row: Row): CiAssetItem {
  const meta = row.link_meta ?? {}
  return {
    id: row.id,
    title: displayTitle(row),
    kind: row.kind,
    sourceKind: row.source_kind,
    storageProvider: row.storage_provider,
    sourceUrl: row.source_url,
    thumbnailUrl: row.thumbnail_url,
    providerLabel: typeof meta.providerLabel === 'string' ? meta.providerLabel : null,
    mime: row.mime,
    sizeText: formatBytes(row.bytes),
    createdAtText: formatKstDateTimeShort(row.created_at),
    openUrl: row.source_kind === 'link'
      ? row.source_url
      : (row.drive_file_id ? `/api/ci/assets/${row.id}/file` : null),
  }
}

const SELECT = `
  id, title, kind, source_kind, storage_provider, source_url, thumbnail_url,
  storage_path, drive_file_id, link_meta, mime, bytes, created_at
`

export interface AssetListParams {
  workspaceId: string
  /** 제목·파일명·주소를 함께 훑는다 */
  q?: string | null
  sourceKind?: 'file' | 'link' | null
  /** 이전 페이지 마지막 항목의 created_at. 없으면 첫 장 */
  cursor?: string | null
  limit?: number
}

export interface AssetListResult {
  items: CiAssetItem[]
  /** 다음 장을 요청할 커서. null이면 끝 */
  nextCursor: string | null
  total: number
}

export async function listAssets(p: AssetListParams): Promise<AssetListResult> {
  const adminClient = createAdminClient() as any
  const limit = p.limit ?? ASSETS_PAGE_SIZE

  let q = adminClient
    .from('ci_assets')
    .select(SELECT, { count: 'exact' })
    .eq('workspace_id', p.workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    // 한 건 더 받아 "다음 장이 있는지"를 별도 쿼리 없이 판정한다
    .limit(limit + 1)

  if (p.sourceKind) q = q.eq('source_kind', p.sourceKind)
  if (p.cursor) q = q.lt('created_at', p.cursor)

  if (p.q?.trim()) {
    // PostgREST or 필터의 값에 쉼표·괄호가 들어가면 문법이 깨진다 — 미리 걷어낸다
    const term = p.q.trim().replace(/[,()*]/g, ' ').slice(0, 80)
    if (term) {
      q = q.or(`title.ilike.%${term}%,storage_path.ilike.%${term}%,source_url.ilike.%${term}%`)
    }
  }

  const { data, count } = await q
  const rows = (data ?? []) as Row[]
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  return {
    items: page.map(toAssetItem),
    nextCursor: hasMore ? page[page.length - 1].created_at : null,
    total: count ?? page.length,
  }
}
