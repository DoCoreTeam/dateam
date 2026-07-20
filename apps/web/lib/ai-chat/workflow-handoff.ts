// 목록 심층분석 — §FR-11-3 업무 흐름 연계(주간보고·부서업무·프로젝트·회의노트) 1회성 전달 브리지.
// 왜 sessionStorage인가: 대상 화면은 서로 다른 라우트라 React state로 넘길 수 없다. 인증 토큰이 아닌
// "분석 결과 텍스트"만 담으므로 CLAUDE.md "토큰 저장 금지" 규칙과 무관(순수 콘텐츠 페이로드).
// 소비(consume)는 1회 read+즉시 삭제 — 대상 화면 새로고침 시 같은 내용이 중복 반영되지 않는다.
// 자동 등록 금지 원칙(§ AI 결과 UI 패턴): 여기서 만드는 건 폼 프리필뿐, 저장은 사용자가 직접 확정한다.

export type WorkflowTarget = 'weekly-report' | 'dept-task' | 'project' | 'meeting-note'

export interface WorkflowHandoffPayload {
  title: string
  bodyMd: string
}

const KEY_PREFIX = 'ai-analysis-handoff:'

function isBrowser(): boolean {
  return typeof window !== 'undefined' && !!window.sessionStorage
}

/** 전달 페이로드를 sessionStorage에 적재(대상별 키 분리 — 동시에 여러 대상 열어도 서로 덮어쓰지 않음). */
export function setWorkflowHandoff(target: WorkflowTarget, payload: WorkflowHandoffPayload): void {
  if (!isBrowser()) return
  try {
    window.sessionStorage.setItem(KEY_PREFIX + target, JSON.stringify(payload))
  } catch {
    // sessionStorage 접근 실패(프라이빗 모드 등)해도 흐름은 계속 — 대상 화면은 빈 폼으로 열릴 뿐
  }
}

/** 페이로드를 1회 소비(read 후 즉시 삭제). 없으면 null. */
export function consumeWorkflowHandoff(target: WorkflowTarget): WorkflowHandoffPayload | null {
  if (!isBrowser()) return null
  try {
    const raw = window.sessionStorage.getItem(KEY_PREFIX + target)
    if (!raw) return null
    window.sessionStorage.removeItem(KEY_PREFIX + target)
    const parsed = JSON.parse(raw) as Partial<WorkflowHandoffPayload>
    if (typeof parsed.title !== 'string' || typeof parsed.bodyMd !== 'string') return null
    return { title: parsed.title, bodyMd: parsed.bodyMd }
  } catch {
    return null
  }
}
