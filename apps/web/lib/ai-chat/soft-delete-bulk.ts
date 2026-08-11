/**
 * 소프트삭제 일괄 처리 SSOT(재사용·단일구현 정책).
 *
 * 왜: 목록 심층분석의 세션(ai_analysis_sessions)·문서(ai_analysis_documents)는
 * `user_id` 소유 + `deleted_at` 소프트삭제라는 **동일 규약**을 쓴다. 선택 삭제/선택 복구를
 * 액션 파일마다 복붙하면 소유 검증·상태 검증 중 하나만 빠져도 IDOR·이중삭제로 이어진다.
 * → 검증·업데이트를 이 한 곳에 두고 각 서버액션은 테이블명만 넘긴다.
 *
 * 규칙: 남의 행/이미 처리된 행은 **조용히 제외**(부분 성공)하고 실제 반영된 id만 돌려준다.
 * 하나도 대상이 없을 때만 오류. 화면은 affectedIds로 목록을 갱신해 낙관적 UI와 DB가 어긋나지 않는다.
 */

import { logDbError } from './log-db-error.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

/** 한 번에 처리 가능한 최대 건수 — 실수/악의적 대량 요청 상한. */
export const MAX_BULK_IDS = 200

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 입력 id 목록 정규화 — 공백 제거·UUID 형식만 통과·중복 제거·상한 절단.
 * 순수 함수(단위테스트 대상): 잘못된 값이 PostgREST `.in()`에 흘러가 쿼리 자체가 깨지는 것을 막는다.
 */
export function normalizeBulkIds(ids: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of ids ?? []) {
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (!UUID_RE.test(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= MAX_BULK_IDS) break
  }
  return out
}

export type SoftDeleteAction = 'delete' | 'restore'

export interface BulkSoftDeleteOk {
  ok: true
  /** 실제로 상태가 바뀐 행 — 목록 갱신은 이 값 기준. */
  affectedIds: string[]
}
export interface BulkSoftDeleteErr {
  ok: false
  error: string
}

export interface BulkSoftDeleteParams {
  table: string
  userId: string
  ids: readonly unknown[]
  action: SoftDeleteAction
  /** 대상이 하나도 없을 때 사용자에게 보일 메시지(도메인별 문구). */
  notFoundError: string
}

/** 소유·상태 선검증 후 일괄 소프트삭제/복구. 실패해도 호출부가 부분 반영을 알 수 있게 affectedIds를 돌려준다. */
export async function bulkSoftDelete(
  admin: AdminClient,
  { table, userId, ids, action, notFoundError }: BulkSoftDeleteParams,
): Promise<BulkSoftDeleteOk | BulkSoftDeleteErr> {
  const candidates = normalizeBulkIds(ids)
  if (candidates.length === 0) return { ok: false, error: '대상을 선택하세요' }

  // 1) 소유 + 현재 상태가 맞는 행만 추린다(default-deny). 남의 행은 여기서 탈락한다.
  let owned = admin.from(table).select('id').in('id', candidates).eq('user_id', userId)
  owned = action === 'delete' ? owned.is('deleted_at', null) : owned.not('deleted_at', 'is', null)

  const { data, error } = await owned
  if (error) {
    logDbError(`bulkSoftDelete:${table}:select`, error, { action, count: candidates.length })
    return { ok: false, error: '대상 조회 중 오류가 발생했습니다' }
  }

  const targetIds = ((data ?? []) as { id: string }[]).map((r) => r.id)
  if (targetIds.length === 0) return { ok: false, error: notFoundError }

  // 2) 업데이트에도 user_id를 다시 건다 — 1)과 2) 사이 경합(TOCTOU) 방어.
  const { error: updateError } = await admin
    .from(table)
    .update({ deleted_at: action === 'delete' ? new Date().toISOString() : null })
    .in('id', targetIds)
    .eq('user_id', userId)
  if (updateError) {
    logDbError(`bulkSoftDelete:${table}:update`, updateError, { action, count: targetIds.length })
    return { ok: false, error: action === 'delete' ? '삭제 중 오류가 발생했습니다' : '되돌리기 중 오류가 발생했습니다' }
  }

  return { ok: true, affectedIds: targetIds }
}
