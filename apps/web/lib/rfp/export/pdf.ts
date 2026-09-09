/**
 * 리포트를 인쇄용 HTML 로 (설계서 3.6.3)
 *
 * ## PDF 를 여기서 만들지 않는 이유
 *
 * 저장소에 이미 PDF 경로가 있다 — 크로미움을 띄워 HTML 을 찍는다.
 * 여기서 PDF 라이브러리를 하나 더 들이면 **글꼴이 다른 두 종류의 PDF** 가 나오고,
 * 한글 글꼴 문제를 두 곳에서 따로 겪는다.
 *
 * 그래서 이 파일은 **인쇄용 HTML 까지만** 만든다. 종이로 바꾸는 것은 기존 경로가 한다.
 */

import type { Report } from '../report/schema.ts'
import { toMarkdown, AI_NOTICE_LINE, type ExportMode } from './markdown.ts'

export interface PrintOptions {
  mode: ExportMode
  caseTitle: string
  generatedAt?: string
}

/**
 * 인쇄용 HTML.
 *
 * 스타일을 문서 안에 넣는 이유: 인쇄 경로는 우리 CSS 를 안 들고 간다.
 * 밖에서 불러오면 글자만 남은 종이가 나온다.
 */
export function toPrintHtml(report: Report, opts: PrintOptions): string {
  const md = toMarkdown(report, opts)
  const body = markdownToHtml(md)
  return [
    '<!doctype html>',
    '<html lang="ko"><head><meta charset="utf-8">',
    `<title>${escapeHtml(opts.caseTitle)}</title>`,
    `<style>${PRINT_CSS}</style>`,
    '</head><body>',
    body,
    '</body></html>',
  ].join('\n')
}

/** 인쇄에 필요한 최소한만 — 화면 CSS 를 흉내 내지 않는다 */
export const PRINT_CSS = `
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
         font-size: 10.5pt; line-height: 1.7; color: #111; }
  h1 { font-size: 18pt; margin: 0 0 12pt; }
  h2 { font-size: 13pt; margin: 18pt 0 6pt; padding-bottom: 3pt; border-bottom: 1px solid #ddd;
       break-after: avoid; }
  ul { margin: 0 0 10pt; padding-left: 16pt; }
  li { margin: 2pt 0; }
  blockquote { margin: 0 0 12pt; padding: 8pt 10pt; background: #f6f6f4;
               border-left: 3px solid #999; font-size: 9.5pt; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 16pt 0 8pt; }
  strong { font-weight: 600; }
`.trim()

/**
 * 우리가 만든 마크다운만 다룬다 — 임의 마크다운 파서가 아니다.
 *
 * 사용자 입력이 아니라 **우리 코드가 만든 문자열**이라 문법이 정해져 있다.
 * 그래도 값에서 온 글자는 이스케이프한다(공고문에 꺾쇠가 들어 있다).
 */
export function markdownToHtml(md: string): string {
  const out: string[] = []
  let inList = false

  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false }
  }

  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()

    if (line.startsWith('# ')) { closeList(); out.push(`<h1>${inline(line.slice(2))}</h1>`); continue }
    if (line.startsWith('## ')) { closeList(); out.push(`<h2>${inline(line.slice(3))}</h2>`); continue }
    if (line.startsWith('> ')) { closeList(); out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`); continue }
    if (line === '---') { closeList(); out.push('<hr>'); continue }

    const li = line.match(/^(\s*)- (.*)$/)
    if (li) {
      if (!inList) { out.push('<ul>'); inList = true }
      const indent = li[1].length > 0 ? ' class="sub"' : ''
      out.push(`<li${indent}>${inline(li[2])}</li>`)
      continue
    }

    closeList()
    if (line) out.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  return out.join('\n')
}

/** **굵게** 만 다룬다. 나머지는 글자 그대로 */
function inline(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 고지가 들어갔는지 — 내보내기 전에 확인한다 */
export function hasAiNotice(html: string): boolean {
  return html.includes(escapeHtml(AI_NOTICE_LINE.slice(2)))
}
