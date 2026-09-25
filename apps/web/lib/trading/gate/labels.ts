/**
 * 관문 화면이 쓰는 말 — 화면 파일 안에 두지 않는다
 * (`lib/ui/glossary.test.ts` 가 화면 안 라벨 표가 늘어나는 것을 막는다)
 */

import type { CriterionStatus } from './criteria.ts'

export const GATE_STATUS_LABEL: Record<CriterionStatus, string> = {
  pass: '통과',
  fail: '미달',
  // 「미달」과 다른 상태다. 나쁜 것이 아니라 아직 모르는 것이다
  insufficient: '아직 못 잼',
}

/** 상태별 색 토큰. 「아직 못 잼」은 붉지 않다 — 붉으면 나쁜 것으로 읽힌다 */
export const GATE_STATUS_COLOR: Record<CriterionStatus, string> = {
  pass: 'var(--text)',
  fail: 'var(--nb-danger)',
  insufficient: 'var(--text-muted)',
}
