export interface RoutineItemParsed {
  name: string
  freq: 'daily' | 'weekly'
}

export const DEFAULT_ROUTINES: RoutineItemParsed[] = [
  { name: 'Morning Standup', freq: 'daily' },
  { name: '리포트 확인', freq: 'daily' },
  { name: '이슈 로그', freq: 'daily' },
  { name: '업무 마감 체크', freq: 'daily' },
]
