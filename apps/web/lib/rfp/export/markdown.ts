/**
 * 리포트 내보내기 (설계서 3.6.3)
 *
 * ## 작업용과 보고용은 같은 JSON 에서 나온다
 *
 * 보고용을 따로 만들면 **두 문서가 다른 말을 한다.** 작업용에는 6억이라 적혀 있는데
 * 보고용에는 5억인 순간이 오고, 그때 어느 쪽이 맞는지 아무도 모른다.
 * 같은 JSON 에서 파생하되 **보고용은 덜 보여 준다** — 근거·벤더·이력을 뺀다.
 *
 * ## AI 고지를 맨 위에 둔다
 *
 * AI 기본법의 투명성 의무다. 그리고 실무적으로도 필요하다 —
 * 이 문서가 결재에 올라갔을 때 「사람이 검토했나」를 묻게 만들어야 한다.
 */

import type { Report, ValueNode, Evidence } from '../report/schema.ts'

export type ExportMode = 'work' | 'report'

/** 맨 위에 붙는 고지 — 빼면 안 된다 */
export const AI_NOTICE_LINE = '> AI 생성 결과입니다. 최종 판단 전에 원문과 대조해 검토해 주세요.'

const SECTION_TITLE: Record<string, string> = {
  overview: '사업 개요',
  scope: '과업 범위',
  schedule: '일정',
  budget: '사업 금액',
  constraints: '제약과 자격',
  checklist: '제출 서류',
  evaluation: '평가 기준',
}

const FIELD_TITLE: Record<string, string> = {
  title: '사업명', agency: '공고 기관', demandAgency: '수요 기관',
  purpose: '사업 목적', background: '추진 배경', summary: '요약',
  projectType: '사업 유형',
  start: '시작일', end: '종료일', durationMonths: '사업 기간(개월)',
  proposalDeadline: '제안 마감', bidOpenDate: '개찰일', qnaDeadline: '질의 마감',
  totalAmount: '총 사업비', currency: '통화', vatIncluded: '부가세 포함',
  budgetBasis: '금액 근거', paymentTerms: '대가 지급',
  method: '평가 방법', technicalWeight: '기술 배점', priceWeight: '가격 배점',
  deliverables: '산출물', workItems: '과업 항목', requirements: '요구사항',
}

export interface ExportOptions {
  mode: ExportMode
  caseTitle: string
  /** 언제 만들었나 */
  generatedAt?: string
}

/**
 * 리포트를 마크다운으로.
 *
 * 보고용은 근거·벤더·검증 배지를 빼되 **값은 같다** — 값이 다르면 두 문서가 싸운다.
 */
export function toMarkdown(report: Report, opts: ExportOptions): string {
  const lines: string[] = []

  lines.push(`# ${opts.caseTitle}`)
  lines.push('')
  // AI 기본법 투명성 의무 — 맨 위다
  lines.push(AI_NOTICE_LINE)
  lines.push('')

  if (opts.mode === 'work') {
    lines.push(`- 분석 모드: ${report.meta.analysisMode}`)
    lines.push(`- 기본 모델: ${report.meta.baseVendor ?? '미상'}`)
    if (report.meta.crossVendors.length > 0) {
      lines.push(`- 교차검증 모델: ${report.meta.crossVendors.join(', ')}`)
    }
    lines.push(`- 파싱 품질: ${report.meta.parserQuality}`)
    lines.push(`- 비용: ${Math.round(report.meta.costKrw).toLocaleString()}원`)
    lines.push('')
  }

  for (const bucket of Object.keys(SECTION_TITLE)) {
    const entries = (report as unknown as Record<string, Record<string, ValueNode<unknown>>>)[bucket]
    if (!entries) continue
    const rows = Object.entries(entries).filter(([, v]) => v.value !== null && v.value !== undefined)
    if (rows.length === 0) continue

    lines.push(`## ${SECTION_TITLE[bucket]}`)
    lines.push('')
    for (const [key, node] of rows) {
      lines.push(...fieldLines(key, node, opts.mode))
    }
    lines.push('')
  }

  if (report.anomalies.length > 0) {
    lines.push('## 이상 조항')
    lines.push('')
    for (const a of report.anomalies as { title?: unknown; rationale?: unknown; grade?: unknown }[]) {
      const grade = opts.mode === 'work' && a.grade ? ` (${String(a.grade)})` : ''
      lines.push(`- **${String(a.title ?? '')}**${grade}`)
      if (a.rationale) lines.push(`  - ${String(a.rationale)}`)
    }
    lines.push('')
  }

  if (opts.generatedAt) {
    lines.push('---')
    lines.push(`생성 ${opts.generatedAt}`)
  }

  return lines.join('\n')
}

function fieldLines(key: string, node: ValueNode<unknown>, mode: ExportMode): string[] {
  const title = FIELD_TITLE[key] ?? key
  const out: string[] = [`- **${title}**: ${formatValue(node.value)}`]

  if (mode === 'report') return out

  // 작업용에만 근거와 벤더와 검증 배지가 붙는다
  if (node.verification !== 'single') out.push(`  - 검증: ${node.verification}`)
  if (node.vendor) out.push(`  - 모델: ${node.vendor}`)
  if (node.grounding === 'unconfirmed') out.push('  - 근거 미확인')
  for (const e of node.evidence.slice(0, MAX_EVIDENCE_PER_FIELD)) {
    out.push(`  - 근거: ${quoteOf(e)}`)
  }
  return out
}

/** 근거를 몇 개까지 실을까 — 전부 실으면 문서가 근거로 채워진다 */
export const MAX_EVIDENCE_PER_FIELD = 3

function quoteOf(e: Evidence): string {
  const page = e.pageNo === null ? '' : ` (${e.pageNo}쪽)`
  const quote = e.quote.length > 120 ? `${e.quote.slice(0, 120)}…` : e.quote
  return `「${quote}」${page}`
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '확인 못 함'
  if (typeof v === 'boolean') return v ? '예' : '아니오'
  if (typeof v === 'number') return v.toLocaleString()
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === 'string' ? x : nameOf(x))).filter(Boolean).join(', ')
  }
  if (typeof v === 'object') return nameOf(v)
  return String(v)
}

function nameOf(v: unknown): string {
  const o = v as { name?: unknown; title?: unknown; code?: unknown }
  return String(o?.name ?? o?.title ?? o?.code ?? JSON.stringify(v))
}

/** 보고용에 근거가 안 들어갔는지 — 내보내기 전에 확인한다 */
export function hasEvidenceLeak(markdown: string): boolean {
  return /근거:|모델:|검증:/.test(markdown)
}
