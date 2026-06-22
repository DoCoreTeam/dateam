import type { DailyLog } from '@/types/database'

/**
 * 원문 raw 헤드 판별 (집계 제외 SSOT).
 *
 * 즉시저장(addRawDailyLog) 1단계로 만든 원문 행은 화면에서 OriginGroupCard 헤더 전용이며,
 * 통계/완료율/이월/캘린더/AI후보 등 모든 집계에서 제외해야 한다(원문 + 분해 자식 이중 카운트 방지).
 *
 * 식별 조합: ai_processed=false AND source_type='manual' AND origin_group_id != null.
 * - 일반 수동 단건(addDailyLog): origin_group_id=null → 제외 안 됨(정상 카운트)
 * - AI 분해 자식(ai_split): ai_processed=true → 제외 안 됨(정상 카운트)
 */
export function isRawHead(log: Pick<DailyLog, 'ai_processed' | 'source_type' | 'origin_group_id'>): boolean {
  return log.ai_processed === false && log.source_type === 'manual' && log.origin_group_id != null
}

/** 집계용: 원문 raw 헤드를 제외한 로그만 남긴다. */
export function excludeRawHeads<T extends Pick<DailyLog, 'ai_processed' | 'source_type' | 'origin_group_id'>>(logs: T[]): T[] {
  return logs.filter((l) => !isRawHead(l))
}

/**
 * Supabase(PostgREST) 쿼리에서 raw 헤드를 제외하는 .or() 절 (집계 쿼리 SSOT).
 * 사용: `query.or(EXCLUDE_RAW_HEAD_OR)` — 다른 .eq() 필터와 AND 결합된다.
 *
 * 의미: raw 헤드만 (ai_processed=false AND origin_group_id NOT NULL)이므로,
 * 그 여집합 = (ai_processed=true OR origin_group_id IS NULL)을 남긴다.
 * source_type에 의존하지 않아도 raw 헤드만 정확히 떨어진다(과거 데이터엔 해당 조합 없음).
 */
export const EXCLUDE_RAW_HEAD_OR = 'ai_processed.eq.true,origin_group_id.is.null'
