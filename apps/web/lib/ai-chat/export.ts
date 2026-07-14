// 대화 → Markdown export (세션 3 §5-1) — 순수 함수, 단위테스트 대상.
// GET /api/admin/ai-chat/export 라우트가 이 함수 산출물을 attachment로 내려준다.
// 코드펜스 원문 보존(이미 마크다운이므로 이스케이프 없음).

import { formatKstDateTimeShort } from '../datetime/kst.ts'

interface ExportConversation {
  title: string
  provider: string
  model: string
  createdAt: string
}

interface ExportMessage {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  citations?: { url: string; title: string }[]
}

/**
 * 파일명 안전화: 다운로드 filename 용.
 * 파일시스템 위험 문자(/ \ : * ? " < > | 및 제어문자)만 '_'로 치환하고 공백을 접는다.
 * 유니코드 글자(한글 등)는 보존 — JS `\w`는 ASCII 전용이라 [^\w] 방식은 한글을 전부 날린다.
 * 경로 탈출 방지: 선두/말미 '.'·'_' 제거('..' 무력화).
 */
export function sanitizeFilename(title: string): string {
  const cleaned = title
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
  return cleaned || 'conversation'
}

/**
 * 대화 전체를 Markdown 문서로 직렬화.
 * - h1 제목 + provider/model/KST 일시 메타
 * - 👤 사용자 / 🤖 어시스턴트 섹션 반복
 * - citations는 각 메시지 말미 각주 목록
 */
export function conversationToMarkdown(
  conv: ExportConversation,
  messages: ExportMessage[],
): string {
  const parts: string[] = []
  parts.push(`# ${conv.title}`)
  parts.push('')
  parts.push(
    `> provider: ${conv.provider} · model: ${conv.model} · ${formatKstDateTimeShort(conv.createdAt)}`,
  )
  parts.push('')

  for (const msg of messages) {
    const heading = msg.role === 'user' ? '## 👤 사용자' : '## 🤖 어시스턴트'
    parts.push(heading)
    parts.push('')
    parts.push(msg.content)
    parts.push('')
    if (msg.citations && msg.citations.length > 0) {
      parts.push('**출처**')
      msg.citations.forEach((c, idx) => {
        parts.push(`${idx + 1}. [${c.title || c.url}](${c.url})`)
      })
      parts.push('')
    }
  }

  return parts.join('\n')
}
