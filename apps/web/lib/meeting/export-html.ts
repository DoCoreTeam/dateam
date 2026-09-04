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

/**
 * 무엇을 담아 내보낼지.
 *
 * `digest`·`transcript` 는 v0.7.685 에 **더한 것**이다 — 기존 둘은 그대로 둔다(M-4 추가 전용).
 * 왜 더했나(사용자 지적): *"내보내는것도 없고"* — 내보내기가 **작성 탭에만** 있었고,
 * 만들어지는 문서에 **전사도 정리도 들어가지 않았다**(제목·요약·본문뿐).
 * 정작 밖으로 보낼 값어치가 있는 것은 받아적은 내용과 안건별 정리다.
 */
export type MeetingExportView = 'refined' | 'original' | 'digest' | 'transcript'

/** 화면이 이 뷰를 뭐라고 부르나 — 화면마다 문자열을 지으면 어긋난다(§0-2) */
export const EXPORT_VIEW_LABEL: Record<MeetingExportView, string> = {
  refined: 'AI 정제본',
  original: '원본',
  digest: '안건별 정리',
  transcript: '받아적은 내용',
}

/** 전사 한 줄 — 시각·화자·발언. 빌더는 표시만 하고 정렬은 호출부가 끝내 둔다 */
export interface ExportSegment {
  timeLabel: string
  speaker: string
  text: string
}

/** 정리 한 안건 — 화면과 같은 구조를 쓴다(두 벌이면 한쪽만 고쳐진다) */
export interface ExportAgenda {
  title: string
  facts: { text: string; originLabel: string }[]
}

export interface ExportDigest {
  /** 이 회의가 어디로 갔는지 한 줄. 화면과 같은 값이다 — 두 벌이면 파일이 다른 문서가 된다(§2-7 D-7) */
  outcome: string
  nextStep: string
  agenda: ExportAgenda[]
  decisions: { text: string; originLabel: string }[]
  conflicts: { memo: string; transcript: string }[]
}

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
  /** transcript 뷰용. 없으면 «받아적은 내용이 없다»고 문서가 밝힌다 */
  segments?: ExportSegment[]
  /** digest 뷰용. 없으면 «정리하지 않았다»고 문서가 밝힌다 */
  digest?: ExportDigest | null
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

/**
 * 받아적은 내용. **한 줄도 줄이지 않는다** — 밖으로 나가는 문서는 화면과 달리 스크롤이 없고,
 * 「전체 보기」를 누를 사람도 없다. 화면의 상한(§전사 상자)은 읽기 편하자고 둔 것이지
 * 내보내기에까지 적용할 이유가 없다.
 */
function renderTranscript(segments: ExportSegment[]): string {
  if (segments.length === 0) return `<p class="empty">받아적은 내용이 없습니다.</p>`
  const rows = segments.map((s) =>
    `<tr><td class="tc">${escapeHtml(s.timeLabel)}</td><td class="sp">${escapeHtml(s.speaker)}</td><td>${escapeHtml(s.text)}</td></tr>`,
  ).join('')
  return `<section class="sec"><h2><span class="no">1</span>받아적은 내용 (${segments.length.toLocaleString()}줄)</h2>`
    + `<table class="tr-table"><tbody>${rows}</tbody></table></section>`
}

/** 안건별 정리. 출처 표시(메모/녹음/둘 다)를 **문서에도 남긴다** — 어디서 나온 사실인지가 정리의 값어치다 */
function renderDigest(d: ExportDigest | null): string {
  if (!d || (d.agenda.length === 0 && d.decisions.length === 0 && !d.outcome)) {
    return `<p class="empty">아직 정리하지 않았습니다.</p>`
  }
  const parts: string[] = []
  // 결론은 번호를 안 붙인다 — 안건이 아니라 «회의 전체가 어디로 갔나»라 층이 다르다
  if (d.outcome) {
    parts.push(`<section class="sec outcome"><h2>이 회의는</h2><p class="pre">${escapeHtml(d.outcome)}</p>`
      + (d.nextStep ? `<p class="next">다음: ${escapeHtml(d.nextStep)}</p>` : '') + `</section>`)
  }
  let n = 0
  if (d.conflicts.length > 0) {
    n += 1
    const items = d.conflicts.map((c) =>
      `<li><span class="ol">메모</span> ${escapeHtml(c.memo)}<br/><span class="ol">녹음</span> ${escapeHtml(c.transcript)}</li>`,
    ).join('')
    parts.push(`<section class="sec"><h2><span class="no">${n}</span>메모와 녹음이 다르게 말한 곳 (${d.conflicts.length}건)</h2><ul class="bullets conflict">${items}</ul></section>`)
  }
  for (const a of d.agenda) {
    n += 1
    const items = a.facts.map((f) => `<li><span class="ol">${escapeHtml(f.originLabel)}</span> ${escapeHtml(f.text)}</li>`).join('')
    parts.push(`<section class="sec"><h2><span class="no">${n}</span>${escapeHtml(a.title)}</h2><ul class="bullets">${items}</ul></section>`)
  }
  if (d.decisions.length > 0) {
    n += 1
    const items = d.decisions.map((x) => `<li><span class="ol">${escapeHtml(x.originLabel)}</span> ${escapeHtml(x.text)}</li>`).join('')
    parts.push(`<section class="sec"><h2><span class="no">${n}</span>결정사항</h2><ul class="bullets">${items}</ul></section>`)
  }
  return parts.join('\n')
}

/** 문서 본문(탭별). refined=요약/결정사항, original=소독된 리치 HTML, digest=안건별 정리, transcript=받아적은 내용. */
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
  if (input.view === 'transcript') return renderTranscript(input.segments ?? [])
  if (input.view === 'digest') return renderDigest(input.digest ?? null)

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
  /* 받아적은 내용 — 시각·화자 칸 폭을 고정해 발언이 들쭉날쭉하지 않게 */
  table.tr-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  table.tr-table td { padding: 4px 8px 4px 0; vertical-align: top; line-height: 1.6; }
  table.tr-table td.tc { width: 52px; color: #9ca3af; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.tr-table td.sp { width: 92px; color: #374151; font-weight: 600; white-space: nowrap; }
  /* 출처 표시 — 이 사실이 메모에서 왔는지 녹음에서 왔는지. 정리의 값어치가 여기 있다 */
  .ol { display: inline-block; min-width: 34px; margin-right: 6px; font-size: 11px; color: #6b7280; }
  ul.bullets.conflict li { margin: 9px 0; }
  .sec.outcome { border-left: 3px solid #374151; padding-left: 12px; }
  .sec.outcome h2 { font-size: 12px; letter-spacing: 0.06em; color: #6b7280; }
  .next { margin: 6px 0 0; font-size: 13px; color: #6b7280; }

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
