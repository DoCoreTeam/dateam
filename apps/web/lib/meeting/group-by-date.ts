// 회의노트 날짜별 그룹핑 (SSOT) — 목록의 "날짜별 보기" 모드가 재사용.
//  meeting_at(KST 로컬) 기준 YYYY-MM-DD로 그룹. 일시 미지정은 별도 섹션(맨 끝).
//  순수 함수 — DB/시간대 부수효과 없음. 입력 순서와 무관하게 날짜 내림차순(미지정 마지막).

export interface DatedItem {
  meeting_at: string | null
}

export interface DateGroup<T> {
  dateKey: string // 'YYYY-MM-DD' 또는 'unscheduled'
  label: string // 표시 라벨
  items: T[]
}

const UNSCHEDULED = 'unscheduled'

// 로컬(브라우저/서버 TZ) 기준 YYYY-MM-DD. 회의일시는 사용자 로컬 날짜로 묶는 게 직관적.
function localDateKey(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function labelFor(dateKey: string): string {
  if (dateKey === UNSCHEDULED) return '일시 미지정'
  const d = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(d.getTime())) return dateKey
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${weekday})`
}

export function groupByMeetingDate<T extends DatedItem>(items: T[]): DateGroup<T>[] {
  const map = new Map<string, T[]>()
  for (const it of items) {
    const key = it.meeting_at ? (localDateKey(it.meeting_at) ?? UNSCHEDULED) : UNSCHEDULED
    const arr = map.get(key)
    if (arr) arr.push(it)
    else map.set(key, [it])
  }
  // 날짜 내림차순(최근 먼저), 미지정은 항상 맨 끝.
  const keys = Array.from(map.keys()).sort((a, b) => {
    if (a === UNSCHEDULED) return 1
    if (b === UNSCHEDULED) return -1
    return a < b ? 1 : a > b ? -1 : 0
  })
  return keys.map((k) => ({ dateKey: k, label: labelFor(k), items: map.get(k) as T[] }))
}
