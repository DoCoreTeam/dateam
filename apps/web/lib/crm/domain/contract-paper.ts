/**
 * 계약서 종이 — 화면 미리보기, PDF, docx 가 같은 재료로 그린다 (P0132 I12)
 *
 * **재료는 한 벌이다.** 미리보기와 파일이 다른 코드로 그려지면 「화면에는 있는데 파일에는 없는」
 * 조항이 생기고, 그것을 발견하는 것은 날인하는 고객이다. 그래서 종이 HTML 과 docx 문단을
 * 둘 다 여기서 만든다.
 *
 * **조항 HTML 은 한 번 더 정리기를 지난다.** 저장 전에 이미 정리했지만, 굽는 자리는 그 사실을
 * 믿지 않는다 — 헤드리스 브라우저가 그리는 글에 스크립트가 끼면 서버에서 돈다(보안 S4).
 * 칸 값은 fillHtml 이 escape 해서 넣었고, 머리글과 서명란의 값은 여기서 escape 한다.
 */

import { AlignmentType, Document, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { sanitizeClauseHtml, stripTags, type Clause } from './contract-body.ts'
import { escapeHtml, type FieldValues } from './contract-fields.ts'
import { CONTRACT_PAPER } from '../../terms/contract-doc.ts'
import { EXPORT_FONT_STACK } from '../../export/font-subset.ts'

export interface ContractPaperSignature {
  partyA: string
  partyB: string
  mark: 'seal' | 'sign' | 'either'
  showCeo: boolean
}

export interface ContractPaperInput {
  contractNo: string
  title: string
  versionNo: number
  /** 칸을 채운 조항 (renderClauses 의 결과) */
  clauses: readonly Clause[]
  fieldValues: FieldValues
  signature: ContractPaperSignature | null
}

const DEFAULT_SIGNATURE: ContractPaperSignature = { partyA: '갑', partyB: '을', mark: 'seal', showCeo: true }

interface Party {
  label: string
  name: string
  address: string
  ceo: string
}

const value = (v: FieldValues, key: string): string => v[key]?.value ?? ''

/** 서명란 양측 — 우리(공급자)가 앞, 고객이 뒤 */
export function signatureParties(input: ContractPaperInput): Party[] {
  const sig = input.signature ?? DEFAULT_SIGNATURE
  const v = input.fieldValues
  return [
    { label: sig.partyA, name: value(v, 'supplier.name'), address: value(v, 'supplier.address'), ceo: sig.showCeo ? value(v, 'supplier.ceo') : '' },
    { label: sig.partyB, name: value(v, 'customer.name'), address: value(v, 'customer.address'), ceo: sig.showCeo ? value(v, 'customer.ceo') : '' },
  ]
}

export const markLabel = (input: ContractPaperInput): string =>
  CONTRACT_PAPER.mark[(input.signature ?? DEFAULT_SIGNATURE).mark]

/** 문서 꼬리 — 서명본을 어느 버전과 맞춰 볼지 종이에 남긴다 */
export const paperFooter = (input: ContractPaperInput): string =>
  CONTRACT_PAPER.footer(input.contractNo, input.versionNo)

// ------------------------------------------------------------
// HTML — 화면 미리보기와 PDF
// ------------------------------------------------------------

/** 종이 안쪽. 화면 미리보기가 이 HTML 을 그대로 그리고 PDF 는 이것을 문서로 감싼다 */
export function contractPaperInnerHtml(input: ContractPaperInput): string {
  const clauses = input.clauses.map((cl) => {
    const title = escapeHtml(stripTags(cl.title))
    return `<section class="clause"><h2>${title}</h2>${sanitizeClauseHtml(cl.html)}</section>`
  }).join('')
  const date = value(input.fieldValues, 'contract.date')
  const parties = signatureParties(input).map((p) => {
    const ceo = p.ceo ? `<dd>${CONTRACT_PAPER.ceo} ${escapeHtml(p.ceo)} ${markLabel(input)}</dd>` : `<dd>${CONTRACT_PAPER.ceo} ${markLabel(input)}</dd>`
    return `<dl class="party"><dt>${escapeHtml(p.label)}</dt>`
      + `<dd>${CONTRACT_PAPER.name} ${escapeHtml(p.name)}</dd>`
      + `<dd>${CONTRACT_PAPER.address} ${escapeHtml(p.address)}</dd>${ceo}</dl>`
  }).join('')
  return `<article class="contract-paper">`
    + `<header><h1>${escapeHtml(input.title)}</h1><p class="no">${escapeHtml(input.contractNo)}</p></header>`
    + clauses
    + `<p class="date">${escapeHtml(date || CONTRACT_PAPER.dateBlank)}</p>`
    + `<div class="parties">${parties}</div>`
    + `<footer>${escapeHtml(paperFooter(input))}</footer>`
    + `</article>`
}

/**
 * 종이 꾸밈 — 화면과 PDF 가 같은 규칙을 쓴다.
 *
 * 글꼴 이름은 EXPORT_FONT_STACK 을 쓴다. 굽는 자리가 얹는 한글 자형은 그 이름으로만 등록되므로,
 * 다른 이름(「Pretendard」)을 적으면 자형은 실리는데 한 글자도 안 쓰여 빈칸이 된다.
 */
export const CONTRACT_PAPER_CSS = `
.contract-paper { font-family: ${EXPORT_FONT_STACK}; color: #111; font-size: 12.5px; line-height: 1.7; }
.contract-paper header { text-align: center; margin-bottom: 20px; }
.contract-paper h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.04em; }
.contract-paper .no { margin: 0; color: #555; font-size: 11px; }
.contract-paper .clause { margin: 0 0 12px; break-inside: avoid; }
.contract-paper h2 { font-size: 13.5px; margin: 0 0 4px; }
.contract-paper p { margin: 0 0 4px; }
.contract-paper table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 11.5px; }
.contract-paper th, .contract-paper td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
.contract-paper .field-empty { color: #b42318; }
.contract-paper .date { text-align: center; margin: 24px 0 16px; }
.contract-paper .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; break-inside: avoid; }
.contract-paper .party { margin: 0; }
.contract-paper .party dt { font-weight: 700; margin-bottom: 4px; }
.contract-paper .party dd { margin: 0 0 2px; }
.contract-paper footer { margin-top: 28px; color: #777; font-size: 10px; text-align: right; }
`

/** PDF 로 굽는 문서 전체 */
export function contractPaperHtml(input: ContractPaperInput): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title>`
    + `<style>body { margin: 0; padding: 28px 32px; } ${CONTRACT_PAPER_CSS}</style></head>`
    + `<body>${contractPaperInnerHtml(input)}</body></html>`
}

// ------------------------------------------------------------
// docx — 조항 글이 종이와 같아야 한다
// ------------------------------------------------------------

const ENTITY: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }
const decode = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (m) => ENTITY[m] ?? m).replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))

export type DocxBlock =
  | { type: 'p'; text: string }
  | { type: 'table'; rows: string[][] }

/**
 * 정리된 조항 HTML 을 문단과 표로 편다.
 *
 * 표를 글로 뭉개지 않는다 — 품목표가 한 줄로 이어 붙으면 금액이 어느 품목 것인지 모른다.
 */
export function clauseBlocks(html: string): DocxBlock[] {
  const clean = sanitizeClauseHtml(html)
  const out: DocxBlock[] = []
  const parts = clean.split(/(<table[\s\S]*?<\/table>)/i)
  for (const part of parts) {
    if (/^<table/i.test(part)) {
      const rows = [...part.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
        [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => decode(stripTags(c[1])).trim()))
      if (rows.length > 0) out.push({ type: 'table', rows })
      continue
    }
    const text = part
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|h3|h4|blockquote)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, '')
    for (const line of decode(text).split('\n')) {
      const t = line.trim()
      if (t) out.push({ type: 'p', text: t })
    }
  }
  return out
}

function docxTable(rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((r) => new TableRow({
      children: r.map((cell) => new TableCell({ children: [new Paragraph({ children: [new TextRun(cell)] })] })),
    })),
  })
}

export function buildContractDocx(input: ContractPaperInput): Document {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: input.title, bold: true, size: 40 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: input.contractNo, color: '555555', size: 18 })] }),
    new Paragraph({ text: '' }),
  ]
  for (const cl of input.clauses) {
    children.push(new Paragraph({ children: [new TextRun({ text: decode(stripTags(cl.title)), bold: true })] }))
    for (const b of clauseBlocks(cl.html)) {
      children.push(b.type === 'table' ? docxTable(b.rows) : new Paragraph({ children: [new TextRun(b.text)] }))
    }
    children.push(new Paragraph({ text: '' }))
  }
  const date = value(input.fieldValues, 'contract.date') || CONTRACT_PAPER.dateBlank
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(date)] }))
  children.push(new Paragraph({ text: '' }))
  for (const p of signatureParties(input)) {
    children.push(new Paragraph({ children: [new TextRun({ text: p.label, bold: true })] }))
    children.push(new Paragraph({ children: [new TextRun(`${CONTRACT_PAPER.name} ${p.name}`)] }))
    children.push(new Paragraph({ children: [new TextRun(`${CONTRACT_PAPER.address} ${p.address}`)] }))
    children.push(new Paragraph({ children: [new TextRun(`${CONTRACT_PAPER.ceo} ${p.ceo} ${markLabel(input)}`.replace(/\s+/g, ' '))] }))
    children.push(new Paragraph({ text: '' }))
  }
  children.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: paperFooter(input), color: '777777', size: 16 })] }))
  return new Document({ sections: [{ children }] })
}

/** 내려받는 파일 이름 — 사람이 읽는 이름. 경로 문자는 뺀다 */
export function contractFileName(input: Pick<ContractPaperInput, 'contractNo' | 'versionNo'>, ext: 'pdf' | 'docx'): string {
  const safe = input.contractNo.replace(/[\\/:*?"<>|\s]+/g, '_')
  return `${safe}_${CONTRACT_PAPER.fileWord}_${CONTRACT_PAPER.fileVersion(input.versionNo)}.${ext}`
}
