// 메모 발견 시스템 공용 유틸
export type MemoStaleness = 'fresh' | 'aging' | 'stale'

export interface MemoListItem {
  id: string
  content: string
  logged_at: string
  log_date?: string
  memo_status: 'new' | 'reviewed' | 'actioned' | null
  memo_reviewed_at?: string | null
  linked_account_id?: string | null
  linked_contact_id?: string | null
  ageDays: number
  staleness: MemoStaleness
}

// 숙성도 색상: 당일🟢 / 2-3일🟡 / 4일+🔴
export const STALENESS_STYLE: Record<MemoStaleness, { dot: string; label: string; text: string }> = {
  fresh: { dot: '#22c55e', label: '오늘/어제', text: '#16a34a' },
  aging: { dot: '#eab308', label: '2-3일 전', text: '#ca8a04' },
  stale: { dot: '#ef4444', label: '4일+ 경과', text: '#dc2626' },
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}일 전`
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}
