// lib/daily/feedback-signals.ts
// Slice 1 (수집만): AI 자동셋팅 결과에 대한 사용자 교정 신호를 ai_feedback_signals 에 적재.
//   - recordFeedbackSignal: best-effort INSERT. 실패해도 throw 안 함(주 액션 보호).
//   - diffDailyLog: 순수 보조함수. 수정 전/후 비교로 correct_* 신호를 산출(단위테스트 대상).
// SSOT: 삭제/수정/캘린더취소 훅이 모두 이 모듈을 import 해 재사용한다.

import type { DailyLogEntryType } from '@/types/database'

// 프로젝트 컨벤션: createClient() 가 반환하는 타입드 클라이언트와 제네릭 SupabaseClient 가
// 충돌하므로(.from 호출 전부 `as any`), 헬퍼 경계는 느슨한 타입으로 받는다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = any

export type FeedbackSignalType =
  | 'reject'
  | 'correct_content'
  | 'correct_type'
  | 'correct_date'
  | 'schedule_reject'
  | 'accept'
  | 'split_reject'

export interface FeedbackSignalPayload {
  userId: string
  logId?: string | null
  originGroupId?: string | null
  promptVersion?: string | null
  signalType: FeedbackSignalType
  field?: string | null
  before?: string | null
  after?: string | null
  originalInput?: string | null
  aiConfidence?: number | null
}

/**
 * ai_feedback_signals 에 신호 1건을 INSERT 한다. **best-effort** —
 * 실패(테이블 미적용/RLS/네트워크)해도 예외를 삼켜 주 액션(삭제·수정·취소)을 막지 않는다.
 * user_id 는 호출자가 인증한 본인(RLS WITH CHECK = auth.uid() 와 일치)만 전달한다.
 */
export async function recordFeedbackSignal(
  supabase: AnySupabaseClient,
  payload: FeedbackSignalPayload,
): Promise<void> {
  try {
    const { error } = await supabase.from('ai_feedback_signals').insert({
      user_id: payload.userId,
      log_id: payload.logId ?? null,
      origin_group_id: payload.originGroupId ?? null,
      prompt_version: payload.promptVersion ?? null,
      signal_type: payload.signalType,
      field: payload.field ?? null,
      before_value: payload.before ?? null,
      after_value: payload.after ?? null,
      original_input: payload.originalInput ?? null,
      ai_confidence: payload.aiConfidence ?? null,
    })
    if (error) console.error('[recordFeedbackSignal] insert failed', error.message)
  } catch (e) {
    console.error('[recordFeedbackSignal] swallowed', e)
  }
}

// ── diffDailyLog (순수함수) ───────────────────────────────────────
// 수정 전/후 스냅샷을 비교해 어떤 correct_* 신호를 낼지 산출한다.
// content → correct_content, entry_type → correct_type,
// target_date 또는 scheduled_at → correct_date. 변경 없으면 빈 배열.

export interface DailyLogDiffSnapshot {
  content?: string | null
  entry_type?: DailyLogEntryType | null
  target_date?: string | null
  scheduled_at?: string | null
}

export interface DailyLogDiff {
  signal_type: Extract<FeedbackSignalType, 'correct_content' | 'correct_type' | 'correct_date'>
  field: string
  before: string | null
  after: string | null
}

function norm(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const t = v.trim()
  return t.length === 0 ? null : t
}

/**
 * before→after 비교로 correct_* 신호 배열을 만든다(순수함수, 부작용 없음).
 * after 가 undefined 인 필드는 "변경 없음"으로 간주(부분 수정 보호).
 * date 는 target_date 우선, 없으면 scheduled_at 으로 1건만 낸다(중복 방지).
 */
export function diffDailyLog(
  before: DailyLogDiffSnapshot,
  after: DailyLogDiffSnapshot,
): DailyLogDiff[] {
  const diffs: DailyLogDiff[] = []

  if (after.content !== undefined && norm(before.content) !== norm(after.content)) {
    diffs.push({
      signal_type: 'correct_content',
      field: 'content',
      before: norm(before.content),
      after: norm(after.content),
    })
  }

  if (after.entry_type !== undefined && (before.entry_type ?? null) !== (after.entry_type ?? null)) {
    diffs.push({
      signal_type: 'correct_type',
      field: 'entry_type',
      before: before.entry_type ?? null,
      after: after.entry_type ?? null,
    })
  }

  // 날짜: target_date 우선, 없으면 scheduled_at — 둘 중 변경된 것 1건만.
  if (after.target_date !== undefined && norm(before.target_date) !== norm(after.target_date)) {
    diffs.push({
      signal_type: 'correct_date',
      field: 'target_date',
      before: norm(before.target_date),
      after: norm(after.target_date),
    })
  } else if (after.scheduled_at !== undefined && norm(before.scheduled_at) !== norm(after.scheduled_at)) {
    diffs.push({
      signal_type: 'correct_date',
      field: 'scheduled_at',
      before: norm(before.scheduled_at),
      after: norm(after.scheduled_at),
    })
  }

  return diffs
}
