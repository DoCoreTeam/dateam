'use client'

// 계약서 종이를 격리된 틀에 그린다 (P0132 I12a)
//
// **왜 iframe 인가**: 조항 본문은 HTML 이다(표·문단 정렬). 화면 DOM 에 직접 넣으려면
// dangerouslySetInnerHTML 을 써야 하는데 그것은 금지다. 서버가 정리기를 지난 글만 주지만
// 화면은 그 약속에 기대지 않는다 — sandbox 를 비워 두면(스크립트·폼·팝업 전부 막힘)
// 출처가 없는 문서가 되고, 앞에 CSP 를 붙여 바깥 요청도 막는다(LOOP.md 7절 S4).

import { escapeHtml } from '@/lib/crm/domain/contract-fields'
import type { Clause } from '@/lib/crm/domain/contract-body'
import styles from './contract-view.module.css'

/** 종이 안에서 바깥으로 나가는 길을 다 막는다. 그림과 글꼴은 서버가 data: 로 싣는다 */
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`

/** 화면용 종이 모양 — 색은 정하지 않는다(틀 안에는 우리 토큰이 없다). 글자 크기와 간격만 */
const SCREEN_STYLE = `<style>
body{margin:0;padding:24px;font-family:system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-size:14px;line-height:1.7;word-break:keep-all;overflow-wrap:anywhere}
.ttl{font-size:20px;font-weight:700;margin:0 0 4px}
.no{margin:0 0 20px;opacity:.7}
h2{font-size:15px;margin:20px 0 6px}
table{border-collapse:collapse;width:100%;margin:8px 0}
th,td{border:1px solid currentColor;padding:4px 6px;text-align:left;vertical-align:top}
.field-empty{font-weight:600;text-decoration:underline dotted}
</style>`

/** 태그를 걷고 escape — 조항 제목은 글자만 찍는다(서버 종이와 같은 규칙) */
const plain = (html: string): string => escapeHtml(
  html.replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
)

/** 화면에서 읽는 종이 — 지금 버전의 채운 조항. 내보내기 권한 없이도 본다 */
export function screenPaperHtml(title: string, contractNo: string, clauses: readonly Clause[]): string {
  const body = clauses
    .map((c) => `<section><h2>${plain(c.title)}</h2>${c.html}</section>`)
    .join('')
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">${CSP}${SCREEN_STYLE}</head>`
    + `<body><p class="ttl">${escapeHtml(title)}</p><p class="no">${escapeHtml(contractNo)}</p>${body}</body></html>`
}

/** 서버가 구운 종이(내보내기 HTML) 앞에 CSP 를 붙인다 */
export function exportedPaperHtml(html: string): string {
  return CSP + html
}

export default function ContractPaperFrame({ html, title, tall = false }: { html: string; title: string; tall?: boolean }) {
  return (
    <iframe
      className={tall ? styles.paperTall : styles.paper}
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={html}
    />
  )
}
