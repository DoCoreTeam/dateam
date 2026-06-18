// 체인지로그 AI 정제 — 커밋 원문(내부 표현 포함)을 "사용자 친화 기능 단위" 변경내역으로 다듬는 프롬프트·파서 SSOT.
// 정책: 자동저장 금지 — 결과는 미리보기로 반환, 어드민이 편집·저장(프로젝트 AI UX '생성형' 패턴).
// 순수 모듈 — 런타임 import 없음(type-only). 변경 항목의 최종 정규화(type 화이트리스트·상한)는
// 호출측(refine 라우트)이 normalize.sanitizeChanges로 적용한다(SSOT 유지).

export interface RefineInput {
  version: string
  /** 정제 대상 원문(커밋 제목/기존 변경문 등) */
  rawLines: string[]
  /** 이미 게시된 내역(톤·형식 참고용 few-shot). title + 변경문구. */
  examples?: { title: string; changes: string[] }[]
}
export interface RefineRaw {
  title: string
  /** JSON에서 추출한 원시 changes(정규화는 호출측 sanitizeChanges) */
  changes: unknown
}

const SYSTEM = `당신은 SaaS 제품의 릴리즈 노트 편집자입니다. 개발 커밋 메시지를 받아 "사용자가 읽을 업데이트 내역"으로 다듬습니다.

규칙:
- 내부/개발 표현 제거: "Playwright 검증", "claude", "tsc", "E2E", "커밋", "리팩터", "design:check", 파일명·함수명·변수명, 버전번호.
- 사용자 관점의 기능 단위로 묶기: 여러 커밋이 한 기능이면 한 항목으로 통합. 중복 제거.
- 각 항목은 간결한 한국어 한 문장(명사형 종결 권장, 예: "GPU 견적 업로드 안정화").
- 각 항목 type: 새 기능="feature", 버그/오류 수정="fix", 개선/최적화="improve".
- 정보가 빈약하면 억지로 만들지 말 것(빈 배열 허용). 과장 금지.
- title: 이 버전을 한 줄로 요약(사용자 관점).

반드시 아래 JSON만 출력:
{"title": string, "changes": [{"text": string, "type": "feature"|"fix"|"improve"}]}`

export function buildRefinePrompt(input: RefineInput): string {
  const lines = input.rawLines.filter((l) => l && l.trim()).map((l) => `- ${l.trim()}`).join('\n')
  let ref = ''
  const ex = (input.examples ?? []).filter((e) => e.title || e.changes.length).slice(0, 5)
  if (ex.length > 0) {
    const sample = ex.map((e) => {
      const cs = e.changes.filter(Boolean).map((c) => `  · ${c}`).join('\n')
      return `· ${e.title}${cs ? '\n' + cs : ''}`
    }).join('\n')
    ref = `\n\n[이미 게시된 업데이트 내역 — 이 톤·형식·길이감에 맞추세요(내용은 복사 금지, 스타일만 참고)]\n${sample}`
  }
  return `${SYSTEM}${ref}\n\n[버전 ${input.version}의 원문 커밋/메모]\n${lines || '(없음)'}\n\nJSON:`
}

/** AI 응답(JSON 문자열) → {title, changes(raw)}. 파싱 실패/잡음(코드펜스) 안전 폴백. changes 정규화는 호출측 sanitizeChanges. */
export function parseRefineOutput(raw: string): RefineRaw {
  let obj: { title?: unknown; changes?: unknown } = {}
  try { obj = JSON.parse(raw) } catch {
    const m = raw.match(/\{[\s\S]*\}/)
    if (m) { try { obj = JSON.parse(m[0]) } catch { obj = {} } }
  }
  const title = typeof obj.title === 'string' ? obj.title.trim().slice(0, 300) : ''
  return { title, changes: Array.isArray(obj.changes) ? obj.changes : [] }
}
