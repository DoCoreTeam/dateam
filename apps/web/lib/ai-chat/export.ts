// 대화 → Markdown/텍스트/HTML export (④ 다운로드 포맷 확장) — 순수 함수, 단위테스트 대상.
// GET /api/admin/ai-chat/export 라우트(md·txt)와 /api/admin/ai-chat/export-pdf 라우트(pdf)가
// 이 함수들의 산출물을 attachment로 내려준다. docx는 클라이언트에서 별도 생성(lib/ai-chat/export-docx.ts).
// 코드펜스 원문 보존(이미 마크다운이므로 이스케이프 없음).

import { formatKstDateTimeShort } from '../datetime/kst.ts'
import { htmlToPlain } from '../html-to-plain.ts'

export interface ExportConversation {
  title: string
  provider: string
  model: string
  createdAt: string
}

export interface ExportMessage {
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

/**
 * 대화 전체를 plain text 문서로 직렬화(.txt export).
 * content는 리치텍스트(HTML)가 섞여 들어올 가능성에 대비해 htmlToPlain으로 방어적 변환한다
 * (정상 케이스인 plain 문자열은 htmlToPlain을 통과해도 그대로 보존됨).
 */
export function conversationToPlainText(
  conv: ExportConversation,
  messages: ExportMessage[],
): string {
  const parts: string[] = []
  parts.push(conv.title)
  parts.push(`provider: ${conv.provider} · model: ${conv.model} · ${formatKstDateTimeShort(conv.createdAt)}`)
  parts.push('')

  for (const msg of messages) {
    parts.push(msg.role === 'user' ? '[사용자]' : '[어시스턴트]')
    parts.push(htmlToPlain(msg.content))
    parts.push('')
    if (msg.citations && msg.citations.length > 0) {
      parts.push('출처:')
      msg.citations.forEach((c, idx) => {
        parts.push(`  ${idx + 1}. ${c.title || c.url} (${c.url})`)
      })
      parts.push('')
    }
  }

  return parts.join('\n')
}

/** HTML 엔티티 이스케이프 — PDF(export-html) 렌더 시 메시지 원문의 `<`/`&` 등이 마크업으로 해석되는 것을 방지. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 대화 전체를 인쇄용 HTML 문서로 직렬화(.pdf export의 렌더 소스, export-pdf 라우트에서 Puppeteer로 변환).
 * 사용자 콘텐츠는 escapeHtml로 이스케이프 후 개행만 <br/>로 치환 — 마크업 주입 차단.
 */
export function conversationToHtmlDocument(
  conv: ExportConversation,
  messages: ExportMessage[],
): string {
  const body = messages
    .map((msg) => {
      const roleLabel = msg.role === 'user' ? '사용자' : '어시스턴트'
      const content = escapeHtml(msg.content).replace(/\n/g, '<br/>')
      const citations =
        msg.citations && msg.citations.length > 0
          ? `<ol class="citations">${msg.citations
              .map((c) => `<li><a href="${escapeHtml(c.url)}">${escapeHtml(c.title || c.url)}</a></li>`)
              .join('')}</ol>`
          : ''
      return `<section class="msg msg-${msg.role}"><h3>${roleLabel}</h3><div class="content">${content}</div>${citations}</section>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(conv.title)}</title>
<style>
  body { font-family: -apple-system, 'Malgun Gothic', sans-serif; color: #1a1a1a; margin: 32px; line-height: 1.6; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 24px; }
  .msg { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e5e5e5; }
  .msg h3 { font-size: 13px; color: #555; margin: 0 0 6px; }
  .msg-user h3 { color: #1d4ed8; }
  .msg-assistant h3 { color: #15803d; }
  .content { font-size: 13px; white-space: pre-wrap; word-break: break-word; }
  .citations { font-size: 11px; color: #666; margin-top: 8px; }
</style>
</head>
<body>
<h1>${escapeHtml(conv.title)}</h1>
<p class="meta">provider: ${escapeHtml(conv.provider)} · model: ${escapeHtml(conv.model)} · ${escapeHtml(formatKstDateTimeShort(conv.createdAt))}</p>
${body}
</body>
</html>`
}
