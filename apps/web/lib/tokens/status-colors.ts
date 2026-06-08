// 업무 상태 색상 단일 소스(SSOT)
// 이전엔 done/doing/planned/blocker/note 색맵이 7개 파일에 복붙되어 있었음.
// 색 하나 바꾸려면 7곳 동기화 필요 → 이 파일 1곳으로 통일.
// 참고: docs/2026-06-07-style-architecture-audit/00-진단보고.md

export type StatusKey = 'done' | 'doing' | 'planned' | 'blocker' | 'note'

export interface StatusColor {
  label: string
  color: string // 텍스트/아이콘 (의미색)
  bg: string // 연한 배경
  border: string // 보더(연색) — NB 화면에서는 var(--border-color) 우선
}

export const STATUS_COLORS: Record<StatusKey, StatusColor> = {
  done: { label: '완료', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  doing: { label: '진행중', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  planned: { label: '예정', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  blocker: { label: '블로커', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  note: { label: '메모', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
}

export const STATUS_KEYS: StatusKey[] = ['done', 'doing', 'planned', 'blocker', 'note']

// 우선순위 색상 SSOT — 이전엔 DeptTaskDetail/DeptTaskFormModal에 라벨이 파편 하드코딩됨.
export type PriorityKey = 'urgent' | 'high' | 'normal' | 'low'

export const PRIORITY_COLORS: Record<PriorityKey, StatusColor> = {
  urgent: { label: '긴급', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  high: { label: '높음', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  normal: { label: '보통', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  low: { label: '낮음', color: '#64748b', bg: '#f1f5f9', border: '#e2e8f0' },
}

export const PRIORITY_KEYS: PriorityKey[] = ['urgent', 'high', 'normal', 'low']

// 배열 형태가 필요한 호출처용 (value 포함)
export const STATUS_LIST: ({ value: StatusKey } & StatusColor)[] = STATUS_KEYS.map(
  (k) => ({ value: k, ...STATUS_COLORS[k] }),
)
