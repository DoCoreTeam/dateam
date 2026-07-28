// 회의록 내보내기(PDF·이미지) 표준 HTML 문서 빌더 (SSOT).
//   · 현재 탭(정제본/원본)에 맞춰 본문을 렌더한다.
//   · plain text 필드(제목·요약·결정사항·참석자)는 escapeHtml로 이스케이프 → 마크업 주입 방지.
//   · bodyHtml(원본)은 호출부에서 sanitizeRichHtml로 이미 소독된 값을 받는다(라우트 책임).
//   · 서버 puppeteer가 page.setContent로 렌더 → page.pdf() / page.screenshot()로 산출.
//   · 순수 함수(부수효과·I/O 없음) → 단위 테스트 대상.
import { escapeHtml } from '../ai-chat/export.ts'

export type MeetingExportView = 'refined' | 'original'

export interface MeetingExportInput {
  title: string
  meetingAtLabel: string
  statusLabel: string
  memberAttendees: string[]
  externalAttendees: string[]
  view: MeetingExportView
  summary: string
  decisions: string
  /** 원본 뷰용 — 반드시 사전 소독된 HTML(라우트에서 sanitizeRichHtml 적용). */
  bodyHtml: string
}

const EMPTY_HTML = new Set(['', '<p></p>', '<p><br></p>', '<p><br/></p>', '<p><br /></p>'])

/** 문서 본문(탭별) 마크업 생성. refined=요약/결정사항, original=소독된 리치 HTML. */
function renderBody(input: MeetingExportInput): string {
  if (input.view === 'refined') {
    const summary = input.summary.trim()
    const decisions = input.decisions.trim()
    if (!summary && !decisions) {
      return `<p class="empty">AI 정제본이 없습니다.</p>`
    }
    const parts: string[] = []
    if (summary) {
      parts.push(
        `<section class="block"><h2>요약</h2><p class="pre">${escapeHtml(summary)}</p></section>`,
      )
    }
    if (decisions) {
      parts.push(
        `<section class="block"><h2>결정사항</h2><p class="pre">${escapeHtml(decisions)}</p></section>`,
      )
    }
    return parts.join('\n')
  }
  // original
  const html = input.bodyHtml.trim()
  if (EMPTY_HTML.has(html) || html === '') {
    return `<p class="empty">본문이 비어 있습니다.</p>`
  }
  // 이미 소독됨(화이트리스트 태그만). 텍스트만 있으면 문단으로 감싼다.
  const wrapped = html.startsWith('<') ? html : `<p>${escapeHtml(html)}</p>`
  return `<section class="block rich">${wrapped}</section>`
}

/** 참석자 chip 목록(멤버 indigo·외부 slate). 없으면 빈 문자열. */
function renderAttendees(members: string[], externals: string[]): string {
  if (members.length === 0 && externals.length === 0) return ''
  const chips = [
    ...members.map((n) => `<span class="chip chip-mem">${escapeHtml(n)}</span>`),
    ...externals.map((n) => `<span class="chip chip-ext">${escapeHtml(n)}</span>`),
  ].join('')
  return `<section class="attendees"><h2>참석자</h2><div class="chips">${chips}</div></section>`
}

/**
 * 회의록 내보내기용 독립 실행 HTML 문서. 외부 리소스 없음(폰트=시스템, CSS 인라인) → 오프라인·CSP 안전.
 */
export function buildMeetingExportHtml(input: MeetingExportInput): string {
  const title = input.title.trim() || '(제목 없음)'
  const viewLabel = input.view === 'refined' ? 'AI 정제본' : '원본'
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
    color: #1e293b; line-height: 1.7; -webkit-font-smoothing: antialiased;
  }
  .doc { max-width: 720px; margin: 0 auto; padding: 48px 44px 56px; }
  header.head { border-bottom: 2px solid #4f46e5; padding-bottom: 20px; margin-bottom: 28px; }
  .kicker { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: #6366f1; text-transform: uppercase; margin: 0 0 8px; }
  h1 { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; color: #0f172a; margin: 0 0 14px; line-height: 1.3; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 13px; color: #64748b; }
  .meta .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #eef2ff; color: #4338ca; font-weight: 700; font-size: 12px; }
  .block { margin: 0 0 26px; }
  .block h2 { font-size: 13px; font-weight: 700; letter-spacing: 0.03em; color: #64748b; margin: 0 0 8px; text-transform: none; }
  .block .pre { margin: 0; white-space: pre-wrap; font-size: 15px; color: #1e293b; }
  .rich { font-size: 15px; color: #1e293b; }
  .rich p { margin: 0 0 10px; }
  .rich ul, .rich ol { margin: 0 0 12px; padding-left: 22px; }
  .rich li { margin: 2px 0; }
  .rich table { border-collapse: collapse; width: 100%; margin: 8px 0 14px; font-size: 14px; }
  .rich th, .rich td { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; }
  .rich th { background: #f8fafc; font-weight: 700; }
  .rich h1, .rich h2, .rich h3 { font-size: 16px; font-weight: 700; color: #0f172a; margin: 14px 0 6px; text-transform: none; letter-spacing: 0; }
  .empty { color: #94a3b8; font-size: 14px; margin: 0; }
  .attendees { border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 8px; }
  .attendees h2 { font-size: 13px; font-weight: 700; color: #64748b; margin: 0 0 10px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-block; padding: 3px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; }
  .chip-mem { background: #eef2ff; color: #4338ca; }
  .chip-ext { background: #f1f5f9; color: #475569; }
  footer.foot { margin-top: 36px; padding-top: 14px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8; text-align: right; }
</style>
</head>
<body>
  <div class="doc">
    <header class="head">
      <p class="kicker">회의록 · ${escapeHtml(viewLabel)}</p>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">
        <span class="badge">${escapeHtml(input.statusLabel)}</span>
        <span>${escapeHtml(input.meetingAtLabel)}</span>
      </div>
    </header>
    ${renderBody(input)}
    ${renderAttendees(input.memberAttendees, input.externalAttendees)}
    <footer class="foot">데이터얼라이언스 · AX사업본부</footer>
  </div>
</body>
</html>`
}
