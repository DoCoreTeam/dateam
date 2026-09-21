// 주간보고 이력 before/after 도출 SSOT — 쓰기경로 무수정(읽기 전용).
// replace_weekly_report RPC(마이그144)가 저장마다 같은 트랜잭션에서
//   ① 변경 전 상태를 weekly_report_snapshots(reason='manual_save')에 스냅샷
//   ② weekly_report_activity(edit/create) 로그
// 를 남긴다 → 활동 A의 before = A 직전(≤ occurred_at) 스냅샷, after = 다음 활동의
// before 스냅샷(=A가 만든 상태) 또는 최신이면 현재 라이브 확정본.
// (마이그144 이전 활동은 대응 스냅샷이 없어 before=[] → diff 없음 = 소급 불가한 과거)

import type { WeeklyRow } from './activity-diff'

export interface WeeklySnapshot {
  id: string
  takenAt: string
  rows: WeeklyRow[]
}

export interface WeeklyActivity {
  id: string
  occurredAt: string
}

export interface BeforeAfter {
  before: WeeklyRow[]
  after: WeeklyRow[]
  beforeSnapshotId: string | null   // 되살리기(restoreWeeklyReportSnapshot) 대상. 대응 스냅샷 없으면 null
  laterEdits: number   // 이 활동 이후 같은 주차에 쌓인 편집 수 = 되살리면 취소되는 건수(0이면 최신)
}

/**
 * 한 주차의 활동들에 대해 before/after rows를 도출한다.
 *
 * ⚠️ activities 는 그 주차의 **전부**여야 한다. 피드 한 페이지에 실린 것만 넘기면
 * 마지막 활동의 after 가 라이브로 잘못 잡히고(실제로는 다음 페이지에 후속 편집이 있음)
 * laterEdits 도 실제보다 작게 세어져 "취소될 편집 0건"이라 거짓말하게 된다.
 *
 * @param activities 그 주차의 활동 전부(정렬 무관, 내부에서 occurred_at asc 정렬)
 * @param snapshots  그 주차의 스냅샷(정렬 무관)
 * @param liveRows   그 주차의 현재 라이브 확정본(가장 최신 활동의 after)
 */
export function resolveWeeklyBeforeAfter(
  activities: WeeklyActivity[],
  snapshots: WeeklySnapshot[],
  liveRows: WeeklyRow[],
): Map<string, BeforeAfter> {
  const acts = [...activities].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0))
  const snaps = [...snapshots].sort((a, b) => (a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : 0))

  // 활동 직전(≤ occurredAt) 가장 최근 스냅샷 = 그 활동의 before.
  const snapOf = (occurredAt: string): WeeklySnapshot | null => {
    let picked: WeeklySnapshot | null = null
    for (const s of snaps) {
      if (s.takenAt <= occurredAt) picked = s
      else break
    }
    return picked
  }

  const out = new Map<string, BeforeAfter>()
  for (let i = 0; i < acts.length; i++) {
    const beforeSnap = snapOf(acts[i].occurredAt)
    const before = beforeSnap?.rows ?? []
    // after = 다음 활동의 before 스냅샷(=이 활동이 만든 상태), 최신이면 라이브.
    const after = i + 1 < acts.length ? (snapOf(acts[i + 1].occurredAt)?.rows ?? []) : liveRows
    // 되살리기는 주차 전체를 그 시점으로 되돌린다 = 이후 활동이 전부 취소된다.
    // 몇 건이 취소되는지는 누르기 전에 말해야 하므로 여기서 세어 함께 돌려준다.
    out.set(acts[i].id, {
      before, after,
      beforeSnapshotId: beforeSnap?.id ?? null,
      laterEdits: acts.length - 1 - i,
    })
  }
  return out
}
