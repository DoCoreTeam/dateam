/**
 * 리포트 내보내기 가드 (설계서 3.6.3)
 *
 * 여기서 잠그는 것 셋
 * - 작업용과 보고용이 같은 JSON 에서 나오고 값이 같은가
 * - 보고용에 근거와 벤더가 안 들어가는가
 * - AI 생성 고지가 맨 위에 반드시 들어가는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  toMarkdown, formatValue, hasEvidenceLeak, AI_NOTICE_LINE, MAX_EVIDENCE_PER_FIELD,
} from './markdown.ts'
import { toPrintHtml, markdownToHtml, escapeHtml, hasAiNotice, PRINT_CSS } from './pdf.ts'
import { emptyReport, makeValue, type Report, type ReportMeta } from '../report/schema.ts'

const META: ReportMeta = {
  analysisMode: 'cross', baseVendor: 'gemini-2.5-pro', crossVendors: ['claude', 'gpt'],
  fallbackApplied: false, costKrw: 3200, durationMs: 42_000, parserQuality: 82,
  generatedAt: '2026-09-09T00:00:00Z', aiNotice: 'AI 생성 결과, 검토 필요', docClass: 'public',
}

function 리포트(): Report {
  const r = emptyReport(META)
  r.overview.title = makeValue('차세대 데이터 플랫폼 구축', {
    vendor: 'gemini-2.5-pro', verification: 'agreed',
    evidence: [{ documentFileId: 'f1', blockId: 'b1', pageNo: 1, quote: '차세대 데이터 플랫폼 구축 사업' }],
  })
  r.budget.totalAmount = makeValue(2_000_000_000, {
    vendor: 'claude', verification: 'majority', grounding: 'confirmed',
    evidence: [
      { documentFileId: 'f1', blockId: 'b2', pageNo: 3, quote: '총 사업비는 금 이십억원정' },
      { documentFileId: 'f1', blockId: 'b3', pageNo: 4, quote: '부가가치세를 포함한 금액' },
      { documentFileId: 'f1', blockId: 'b4', pageNo: 5, quote: '세 번째 근거' },
      { documentFileId: 'f1', blockId: 'b5', pageNo: 6, quote: '네 번째 근거' },
    ],
  })
  r.budget.vatIncluded = makeValue(true, { grounding: 'unconfirmed' })
  r.schedule.durationMonths = makeValue(12)
  r.scope.deliverables = makeValue([{ name: '설계서' }, { name: '소스코드' }])
  r.anomalies = [{ title: '법정 공고 기간', rationale: '20일이다', grade: 'confirmed' }]
  return r
}

const 옵션 = (mode: 'work' | 'report') => ({ mode, caseTitle: '○○사업', generatedAt: '2026-09-09' })

// AI 고지

test('AI 고지가 맨 위에 들어간다', () => {
  for (const mode of ['work', 'report'] as const) {
    const md = toMarkdown(리포트(), 옵션(mode))
    const lines = md.split('\n').filter(Boolean)
    // AI 기본법 투명성 의무 — 빼면 안 된다
    assert.equal(lines[1], AI_NOTICE_LINE, `${mode} 에서 고지가 두 번째 줄이 아니다`)
  }
})

test('빈 리포트에도 고지가 들어간다', () => {
  const md = toMarkdown(emptyReport(META), 옵션('report'))
  assert.ok(md.includes(AI_NOTICE_LINE))
})

test('인쇄용 HTML 에도 고지가 남는다', () => {
  const html = toPrintHtml(리포트(), 옵션('report'))
  assert.ok(hasAiNotice(html))
  assert.match(html, /<blockquote>/)
})

// 같은 JSON, 다른 노출

test('작업용과 보고용의 값이 같다', () => {
  const work = toMarkdown(리포트(), 옵션('work'))
  const report = toMarkdown(리포트(), 옵션('report'))
  // 값이 다르면 두 문서가 싸우고 어느 쪽이 맞는지 아무도 모른다
  for (const v of ['차세대 데이터 플랫폼 구축', '2,000,000,000', '12']) {
    assert.ok(work.includes(v), `작업용에 ${v} 가 없다`)
    assert.ok(report.includes(v), `보고용에 ${v} 가 없다`)
  }
})

test('보고용에 근거와 벤더와 검증 배지가 없다', () => {
  const md = toMarkdown(리포트(), 옵션('report'))
  assert.equal(hasEvidenceLeak(md), false)
  assert.equal(md.includes('gemini-2.5-pro'), false)
  assert.equal(md.includes('총 사업비는 금 이십억원정'), false)
  assert.equal(md.includes('근거 미확인'), false)
})

test('작업용에는 근거와 벤더가 있다', () => {
  const md = toMarkdown(리포트(), 옵션('work'))
  assert.ok(hasEvidenceLeak(md))
  assert.match(md, /모델: claude/)
  assert.match(md, /근거: 「총 사업비는 금 이십억원정」 \(3쪽\)/)
  assert.match(md, /근거 미확인/)
  // 분석 모드와 비용도 작업용에만
  assert.match(md, /분석 모드: cross/)
  assert.match(md, /3,200원/)
})

test('한 필드에 근거를 셋까지만 싣는다', () => {
  const md = toMarkdown(리포트(), 옵션('work'))
  // 총 사업비 항목 아래의 근거 줄만 센다 — 근거가 넷인 필드다
  const block = md.slice(md.indexOf('**총 사업비**'))
  const count = (block.slice(0, block.indexOf('- **부가세')).match(/근거: 「/g) ?? []).length
  // 전부 실으면 문서가 근거로 채워진다
  assert.equal(count, MAX_EVIDENCE_PER_FIELD)
  assert.equal(block.includes('네 번째 근거'), false)
})

test('값이 없는 필드는 안 싣는다', () => {
  const r = emptyReport(META)
  r.budget.totalAmount = makeValue<number>(null as never)
  const md = toMarkdown(r, 옵션('work'))
  assert.equal(md.includes('총 사업비'), false)
})

test('이상 조항 등급은 작업용에만 붙는다', () => {
  assert.match(toMarkdown(리포트(), 옵션('work')), /법정 공고 기간\*\* \(confirmed\)/)
  assert.match(toMarkdown(리포트(), 옵션('report')), /법정 공고 기간\*\*\n/)
})

// 값 표시

test('값 종류마다 사람이 읽는 모양으로 바꾼다', () => {
  assert.equal(formatValue(2_000_000_000), '2,000,000,000')
  assert.equal(formatValue(true), '예')
  assert.equal(formatValue(false), '아니오')
  assert.equal(formatValue(null), '확인 못 함')
  assert.equal(formatValue(['가', '나']), '가, 나')
  assert.equal(formatValue([{ name: '설계서' }]), '설계서')
})

// HTML

test('꺾쇠가 든 값을 그대로 넣지 않는다', () => {
  const r = emptyReport(META)
  r.overview.title = makeValue('<script>alert(1)</script>')
  const html = toPrintHtml(r, 옵션('report'))
  // 공고문에 꺾쇠가 들어 있다
  assert.equal(html.includes('<script>alert(1)</script>'), false)
  assert.match(html, /&lt;script&gt;/)
})

test('마크다운을 우리 문법만큼만 옮긴다', () => {
  const html = markdownToHtml('# 제목\n\n> 고지\n\n- **굵게**: 값\n  - 하위\n\n---')
  assert.match(html, /<h1>제목<\/h1>/)
  assert.match(html, /<blockquote>고지<\/blockquote>/)
  assert.match(html, /<strong>굵게<\/strong>/)
  assert.match(html, /<li class="sub">하위<\/li>/)
  assert.match(html, /<hr>/)
})

test('목록이 제대로 닫힌다', () => {
  const html = markdownToHtml('- 가\n- 나\n\n## 다음')
  assert.equal((html.match(/<ul>/g) ?? []).length, 1)
  assert.equal((html.match(/<\/ul>/g) ?? []).length, 1)
  assert.ok(html.indexOf('</ul>') < html.indexOf('<h2>'))
})

test('인쇄 스타일이 문서 안에 들어간다', () => {
  const html = toPrintHtml(리포트(), 옵션('report'))
  // 밖에서 불러오면 글자만 남은 종이가 나온다
  assert.ok(html.includes(PRINT_CSS))
  assert.match(html, /@page/)
})

test('이스케이프가 네 글자를 다 다룬다', () => {
  assert.equal(escapeHtml('<&>"'), '&lt;&amp;&gt;&quot;')
})
