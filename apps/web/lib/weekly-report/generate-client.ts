// 선택 후보(일일업무·메모)를 주간보고 행으로 변환하는 클라이언트 호출 SSOT.
// 왜: DailyTaskSelector(일일업무)와 MemoIntakeList(미처리 메모)가 동일하게
//     /api/weekly-report/generate-from-tasks를 호출한다 — 복붙 대신 이 함수를 재사용한다.

export interface WeeklyRow {
  category: string
  performance: string
  plan: string
  issues: string
}

export interface CandidateTaskInput {
  content: string
  entry_type: string
  log_date: string
  is_resolved?: boolean
  priority?: string
}

/** 후보 태스크 배열 → 주간보고 행. 실패 시 Error throw(호출부가 메시지 표시). */
export async function generateWeeklyRows(tasks: CandidateTaskInput[]): Promise<WeeklyRow[]> {
  const res = await fetch('/api/weekly-report/generate-from-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tasks }),
  })
  const data = (await res.json()) as { rows?: WeeklyRow[]; error?: string }
  if (!res.ok || !data.rows) {
    throw new Error(data.error ?? 'AI 생성 중 오류가 발생했습니다')
  }
  return data.rows
}
