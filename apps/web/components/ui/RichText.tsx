// 리치텍스트(주간보고 Tiptap HTML) 렌더 공용 컴포넌트 (SSOT).
// 화면마다 dangerouslySetInnerHTML을 직접 쓰던 것을 통일 — 항상 sanitize 후 렌더.
// plain text(태그 없음)는 그대로 텍스트 노드로, 빈값은 placeholder.
import type { CSSProperties } from 'react'

// 표 태그 추가(목록 심층분석 리치에디터 구조 보존, v0.7.378~). 속성은 여전히 전량 제거 → XSS 방어 유지.
const ALLOWED_TAGS = /^(p|ul|ol|li|strong|em|br|span|b|i|table|thead|tbody|tr|td|th|h[1-6])$/i

// 빈 리치텍스트로 간주하는 Tiptap 산출 패턴들(placeholder 렌더 대상)
const EMPTY_HTML = new Set(['', '<p></p>', '<p><br></p>', '<p><br/></p>', '<p><br /></p>'])

export function sanitizeRichHtml(html: string): string {
  return html
    // script/style 블록 통째 제거(허용 태그 외 내용 텍스트 누출/실행 방지)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    // 여는 태그: 화이트리스트만 통과 + 속성 전부 제거(onclick 등 이벤트 핸들러 차단)
    .replace(/<([a-z][a-z0-9]*)[^>]*>/gi, (_m, tag: string) => (ALLOWED_TAGS.test(tag) ? `<${tag.toLowerCase()}>` : ''))
    .replace(/<\/([a-z][a-z0-9]*)[^>]*>/gi, (_m, tag: string) => (ALLOWED_TAGS.test(tag) ? `</${tag.toLowerCase()}>` : ''))
}

interface RichTextProps {
  html: string | null | undefined
  placeholder?: string
  style?: CSSProperties
  className?: string
}

export default function RichText({ html, placeholder = '-', style, className }: RichTextProps) {
  const value = html ?? ''
  if (EMPTY_HTML.has(value.trim())) {
    return <span style={{ color: 'var(--border-subtle)' }}>{placeholder}</span>
  }
  if (value.startsWith('<')) {
    return <div className={`report-rich${className ? ' ' + className : ''}`} style={style} dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(value) }} />
  }
  return <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text)', lineHeight: 1.6, ...style }}>{value}</p>
}
