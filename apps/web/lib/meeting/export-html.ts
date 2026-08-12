// 회의록 내보내기(PDF·이미지) 문서 빌더 (SSOT).
//   · 화면 UI를 그대로 찍지 않는다 — 밖으로 나가는 산출물이므로 "회의록 문서" 서식을 따른다.
//     제목 아래 라벨-값 표(작성일시·작성자·참석자) → 번호 붙은 절 → 이상/발행 주체. 일반적인 회의록 양식.
//     부서는 표에 넣지 않는다 — 하단 발행 주체가 이미 밝힌다.
//   · 상태(작성중/확정)는 문서에 넣지 않는다 — 내부 작업 상태지 회의 사실이 아니다.
//   · plain text 필드는 escapeHtml로 이스케이프 → 마크업 주입 방지.
//   · bodyHtml(원본)은 호출부에서 sanitizeRichHtml로 이미 소독된 값을 받는다(라우트 책임).
//   · 서버 puppeteer가 page.setContent로 렌더 → page.pdf() / page.screenshot()로 산출.
//   · 순수 함수(부수효과·I/O 없음) → 단위 테스트 대상.
import { escapeHtml } from '../ai-chat/export.ts'

export type MeetingExportView = 'refined' | 'original'

export interface MeetingExportInput {
  title: string
  meetingAtLabel: string
  /** 작성자 이름. 모르면 빈 문자열 — 지어내지 않고 행을 숨긴다. */
  authorName?: string
  memberAttendees: string[]
  externalAttendees: string[]
  view: MeetingExportView
  summary: string
  decisions: string
  /** 원본 뷰용 — 반드시 사전 소독된 HTML(라우트에서 sanitizeRichHtml 적용). */
  bodyHtml: string
}

const EMPTY_HTML = new Set(['', '<p></p>', '<p><br></p>', '<p><br/></p>', '<p><br /></p>'])

/** "- 항목" 줄이 이어지면 실제 목록으로 — 회의록에서 개조식은 글머리표로 보여야 읽힌다. */
function renderTextBlock(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const bulletish = lines.length > 1 && lines.every((l) => /^[-–—·•*]\s?/.test(l))
  if (bulletish) {
    const items = lines.map((l) => `<li>${escapeHtml(l.replace(/^[-–—·•*]\s?/, ''))}</li>`).join('')
    return `<ul class="bullets">${items}</ul>`
  }
  return `<p class="pre">${escapeHtml(text)}</p>`
}

/** 문서 본문(탭별). refined=요약/결정사항, original=소독된 리치 HTML. */
function renderBody(input: MeetingExportInput): string {
  if (input.view === 'refined') {
    const summary = input.summary.trim()
    const decisions = input.decisions.trim()
    if (!summary && !decisions) return `<p class="empty">AI 정제본이 없습니다.</p>`
    const parts: string[] = []
    if (summary) parts.push(`<section class="sec"><h2><span class="no">1</span>회의 내용</h2>${renderTextBlock(summary)}</section>`)
    if (decisions) {
      const n = summary ? 2 : 1
      parts.push(`<section class="sec"><h2><span class="no">${n}</span>결정사항</h2>${renderTextBlock(decisions)}</section>`)
    }
    return parts.join('\n')
  }
  const html = input.bodyHtml.trim()
  if (EMPTY_HTML.has(html) || html === '') return `<p class="empty">본문이 비어 있습니다.</p>`
  const wrapped = html.startsWith('<') ? html : `<p>${escapeHtml(html)}</p>`
  return `<section class="sec"><h2><span class="no">1</span>회의 내용</h2><div class="rich">${wrapped}</div></section>`
}

/** 라벨-값 한 행. 값이 비면 행 자체를 만들지 않는다(빈 칸을 문서에 남기지 않는다). */
function metaRow(label: string, value: string): string {
  if (!value.trim()) return ''
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
}

/**
 * 회의록 문서 HTML. 외부 리소스 없음(폰트=시스템, CSS 인라인) → 오프라인·CSP 안전.
 */
export function buildMeetingExportHtml(input: MeetingExportInput): string {
  const title = input.title.trim() || '(제목 없음)'
  const attendees = [...input.memberAttendees, ...input.externalAttendees]
  // 부서는 문서 하단 발행 주체에 이미 있다 — 표에 또 넣지 않는다.
  const meta = [
    metaRow('작성일시', input.meetingAtLabel),
    metaRow('작성자', input.authorName ?? ''),
    metaRow('참석자', attendees.join(', ')),
  ].filter(Boolean).join('\n      ')

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
    color: #1f2937; line-height: 1.75; -webkit-font-smoothing: antialiased;
  }
  .doc { max-width: 740px; margin: 0 auto; padding: 56px 48px 44px; }

  /* 표제 — 자간을 벌린 문서 종별, 가운데 제목, 그 아래 굵은 괘선 + 짧은 강조선. */
  .doctype { text-align: center; font-size: 12px; letter-spacing: 0.42em; color: #9ca3af; margin: 0 0 12px; padding-left: 0.42em; }
  h1 { text-align: center; font-size: 28px; font-weight: 800; letter-spacing: -0.02em; color: #111827; margin: 0 0 24px; line-height: 1.35; }
  .rule { position: relative; border: 0; border-top: 2.5px solid #111827; margin: 0; }
  .rule::after {
    content: ''; position: absolute; left: 50%; top: -2.5px; width: 84px; height: 2.5px;
    background: #4f46e5; transform: translateX(-50%);
  }

  /* 라벨-값 표 — 회의록의 얼굴. 라벨은 자간을 벌려 값과 역할을 분리한다. */
  table.meta { width: 100%; border-collapse: collapse; margin: 0 0 36px; font-size: 14px; }
  table.meta th, table.meta td { border-bottom: 1px solid #eef0f3; padding: 12px 4px; text-align: left; vertical-align: top; }
  table.meta th { width: 104px; color: #6b7280; font-weight: 600; white-space: nowrap; letter-spacing: 0.06em; }
  table.meta td { color: #111827; font-weight: 500; }

  /* 절 제목 — 번호를 짙은 사각 배지로 떼어내 본문과 층을 만든다. */
  .sec { margin: 0 0 32px; }
  .sec h2 {
    font-size: 15px; font-weight: 800; color: #111827; line-height: 1.4;
    margin: 0 0 14px; display: flex; align-items: center; gap: 10px;
  }
  .sec h2 .no {
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; flex: 0 0 22px;
    background: #111827; color: #ffffff; border-radius: 4px;
    font-size: 12px; font-weight: 700;
  }
  .pre { margin: 0; white-space: pre-wrap; font-size: 14.5px; }
  ul.bullets { margin: 0; padding-left: 20px; font-size: 14.5px; }
  ul.bullets li { margin: 5px 0; padding-left: 2px; }

  .rich { font-size: 14.5px; }
  .rich p { margin: 0 0 10px; }
  .rich ul, .rich ol { margin: 0 0 12px; padding-left: 22px; }
  .rich li { margin: 3px 0; }
  .rich table { border-collapse: collapse; width: 100%; margin: 8px 0 14px; font-size: 13.5px; }
  .rich th, .rich td { border: 1px solid #d1d5db; padding: 7px 10px; text-align: left; }
  .rich th { background: #f9fafb; font-weight: 700; }
  .rich h1, .rich h2, .rich h3 { font-size: 15px; font-weight: 700; color: #111827; margin: 16px 0 6px; text-align: left; letter-spacing: 0; border: 0; padding: 0; }
  .empty { color: #9ca3af; font-size: 14px; margin: 0; }

  /* 마무리 — 문서의 끝을 알리고 발행 주체를 밝힌다. */
  .end { text-align: center; font-size: 12.5px; color: #6b7280; letter-spacing: 0.3em; margin: 38px 0 0; padding-left: 0.3em; }
  footer.foot { margin-top: 14px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 11.5px; color: #9ca3af; text-align: right; }
</style>
</head>
<body>
  <div class="doc">
    <p class="doctype">회 의 록</p>
    <h1>${escapeHtml(title)}</h1>
    <hr class="rule" />
    <table class="meta">
      ${meta}
    </table>
    ${renderBody(input)}
    <p class="end">— 이 상 —</p>
    <footer class="foot">데이터얼라이언스 · AX사업본부</footer>
  </div>
</body>
</html>`
}
