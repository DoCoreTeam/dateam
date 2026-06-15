import type { DailyLog } from '@/types/database'

/**
 * 일일업무 → 캘린더 "일정 후보" 선정 (P2, 결정론).
 *
 * 비파괴: AI 재호출 없음. 이미 추출·저장된 scheduled_at / target_date 값만 사용한다.
 * 자동 등록 절대 금지 — 이 모듈은 후보 목록과 start_at 만 계산하며 INSERT 하지 않는다.
 */

/** 일정성 항목 1건의 화면·INSERT용 표현 */
export interface ScheduleCandidate {
  /** 근거 daily_log id (calendar_events.link_id 로 사용) */
  logId: string
  /** 일정 제목 = log.content */
  title: string
  /** 캘린더 INSERT용 start_at (ISO) — scheduled_at 우선, 없으면 target_date 09:00 */
  startAt: string
  /** 화면 표시용 날짜 라벨 (YYYY-MM-DD) */
  dateLabel: string
  /** 시각이 명시됐는지(scheduled_at) — false면 09:00 기본값을 붙인 것 */
  hasTime: boolean
}

/** 기본 일정 시각 — target_date 만 있을 때(시각 미지정) 업무 시작 09:00 */
const DEFAULT_HOUR = 9

/**
 * scheduled_at(우선) 또는 target_date(09:00) 로 INSERT용 start_at 을 만든다.
 * - scheduled_at: 이미 시각 포함 ISO → 그대로 사용
 * - target_date: 'YYYY-MM-DD' → 로컬 09:00 의 ISO 로 변환
 * 둘 다 없으면 null(후보 제외).
 */
export function deriveStartAt(log: Pick<DailyLog, 'scheduled_at' | 'target_date'>): {
  startAt: string
  dateLabel: string
  hasTime: boolean
} | null {
  if (log.scheduled_at) {
    const d = new Date(log.scheduled_at)
    if (Number.isNaN(d.getTime())) return null
    return { startAt: log.scheduled_at, dateLabel: log.scheduled_at.slice(0, 10), hasTime: true }
  }
  if (log.target_date) {
    // 'YYYY-MM-DD' 만 매칭(저장 형식). 로컬 09:00 ISO 생성.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(log.target_date)
    if (!m) return null
    const [, y, mo, da] = m
    const d = new Date(Number(y), Number(mo) - 1, Number(da), DEFAULT_HOUR, 0, 0, 0)
    if (Number.isNaN(d.getTime())) return null
    // 존재하지 않는 날짜(예: 2026-02-29)는 JS Date가 조용히 롤오버(3-01)시킴 → 잘못된 일정 방지
    if (d.getFullYear() !== Number(y) || d.getMonth() !== Number(mo) - 1 || d.getDate() !== Number(da)) return null
    return { startAt: d.toISOString(), dateLabel: log.target_date, hasTime: false }
  }
  return null
}

/**
 * 그룹 logs 중 일정성 항목(scheduled_at 또는 target_date 보유)을 후보로 선정한다.
 * - 제목 공백 항목 제외
 * - 이미 캘린더에 연결된 logId(linkedLogIds) 제외
 * 입력 순서 유지.
 */
export function selectScheduleCandidates(
  logs: DailyLog[],
  linkedLogIds: ReadonlySet<string> = new Set(),
): ScheduleCandidate[] {
  const result: ScheduleCandidate[] = []
  for (const log of logs) {
    if (linkedLogIds.has(log.id)) continue
    const title = (log.content ?? '').trim()
    if (!title) continue
    const derived = deriveStartAt(log)
    if (!derived) continue
    result.push({
      logId: log.id,
      title,
      startAt: derived.startAt,
      dateLabel: derived.dateLabel,
      hasTime: derived.hasTime,
    })
  }
  return result
}
