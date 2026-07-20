// 주간보고 주차 연속성 SSOT(순수·테스트 대상) — 단일 ?week= 파라미터 해석/클램프.
// mine·team 뷰는 8주 옵션(select) 제약이라 윈도우로 클램프, org 뷰는 무제한 과거(유효 월요일) 허용.

/** YYYY-MM-DD 이고 UTC 월요일인지. */
export function isMondayStr(s?: string): boolean {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).getUTCDay() === 1
}

/** ?week=(레거시 orgWeek/editWeek 포함) → 선택 주차. 8주 옵션 내이거나 유효 월요일이면 채택, 아니면 이번주(옵션[0]). */
export function resolveSelectedWeek(weekParam: string | undefined, weekOptions: string[]): string {
  if (weekParam && (weekOptions.includes(weekParam) || isMondayStr(weekParam))) return weekParam
  return weekOptions[0]
}

/** 8주 윈도우로 클램프 — 옵션 밖이면 이번주. (mine/team 폼·select 제약) */
export function clampToWindow(week: string, weekOptions: string[]): string {
  return weekOptions.includes(week) ? week : weekOptions[0]
}

/** 탭이 실제로 표시하는 주차 — org는 selectedWeek(무제한), 그 외는 윈도우 클램프.
 *  WeekPicker가 이 값을 표시해야 "선택 표시"와 "실제 콘텐츠"가 일치한다(DC-REV CRITICAL 방지). */
export function tabEffectiveWeek(tab: string, selectedWeek: string, weekOptions: string[]): string {
  return tab === 'org' ? selectedWeek : clampToWindow(selectedWeek, weekOptions)
}
