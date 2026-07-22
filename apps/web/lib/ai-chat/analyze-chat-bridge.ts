// 목록 심층분석 → AI 채팅 "이어가기" 1회성 전달 브리지.
//
// 왜 sessionStorage인가: analyze 결과 화면과 /ai-chat은 다른 라우트라 React state로 못 넘긴다.
// 인증 토큰이 아니라 "분석 결과 텍스트"만 담으므로 CLAUDE.md "토큰 저장 금지"와 무관.
//
// 왜 서버액션(continueInChat) 대신 이 브리지인가: continueInChat은 user 메시지만 저장하고
// AI 응답을 트리거하지 않아, 채팅에 들어가도 AI가 답하지 않았다(실측 사고). 이 브리지로 넘기면
// 채팅 진입 시 handleSend(=user 저장 + AI 스트림)를 자동 호출해 AI가 바로 이어서 답한다.

const KEY = 'ai-analyze-continue-chat'

function isBrowser(): boolean {
  return typeof window !== 'undefined' && !!window.sessionStorage
}

/** 이어갈 내용(그룹 원문 + 심화 결과)을 조립해 적재한다. */
export function setAnalyzeChatHandoff(itemText: string, resultText: string): void {
  if (!isBrowser()) return
  const content =
    `${itemText}\n\n---\n[이전 분석 결과]\n${resultText}\n\n---\n` +
    '위 분석을 이어서 더 구체적으로 논의하고 싶습니다. 핵심을 짚고 다음 질문을 제안해 주세요.'
  try {
    window.sessionStorage.setItem(KEY, content)
  } catch {
    // 접근 실패(프라이빗 모드 등)해도 흐름은 계속 — 채팅은 빈 대화로 열릴 뿐
  }
}

/** 1회 소비(read 후 즉시 삭제). 없으면 null. 새로고침 시 중복 전송 방지. */
export function consumeAnalyzeChatHandoff(): string | null {
  if (!isBrowser()) return null
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    window.sessionStorage.removeItem(KEY)
    return raw
  } catch {
    return null
  }
}
