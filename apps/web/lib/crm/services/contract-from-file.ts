/**
 * 계약서 파일로 템플릿 만들기 (P0132 I07)
 *
 * **글은 코드가 옮기고, AI 는 칸 자리만 짚는다.**
 * 조항 나누기는 「제N조」 줄을 보고 코드가 한다. AI 가 조항을 다시 쓰면 원문과 한 글자라도
 * 다른 계약서가 템플릿이 되고, 그 차이를 사람이 찾을 길이 없다.
 * AI 가 하는 일은 「이 글자는 고객 상호다」처럼 **원문에 그대로 있는 글자**를 칸 이름과
 * 짝짓는 것뿐이고, 바꾸기는 코드가 한다. 바꾼 뒤 칸을 원래 글자로 되돌려 원문과 같은지
 * 대조하고, 안 같으면 그 제안은 버린다.
 *
 * **AI 가 실패해도 템플릿은 만들어진다.** 예산이 막혔거나 모델이 엉뚱한 답을 주면
 * 칸 없이 글만 들인 템플릿이 작성 중으로 저장된다(「글만 들이기」). 칸은 사람이 넣으면 된다.
 */

import { z } from 'zod'
import type { CrmDb } from '../db/client.ts'
import { CrmError } from '../domain/errors.ts'
import { parseFile } from '../../rfp/parse/index.ts'
import { runAi, type AiAdapter } from '../ai/runner.ts'
import { CONTRACT_TEMPLATE_FROM_DOC_V1 } from '../ai/prompts/contract-template-from-doc.v1.ts'
import { adapterFromSetting } from './quick-create.ts'
import { readQuoteSupplier } from './setting.ts'
import { checkQuoteFile } from './quote-from-file.ts'
import { irToSourceText } from './quote-source-text.ts'
import { CONTRACT_FIELDS, escapeHtml, fieldToken } from '../domain/contract-fields.ts'
import { MAX_CLAUSES, type Clause } from '../domain/contract-body.ts'
import type { DetectedKind } from '../../rfp/parse/quality.ts'
import { CONTRACT_FROM_FILE } from '../../terms/contract-doc.ts'

/** 계약서는 견적서보다 길다 — 스무 쪽 남짓을 다 읽을 만큼 */
export const MAX_CONTRACT_SOURCE_CHARS = 40_000

/** 이보다 짧은 글자를 칸으로 바꾸면 「을」 「원」 같은 조각이 본문 곳곳에서 바뀐다 */
export const MIN_SUGGESTION_CHARS = 2

const CLAUSE_HEAD = /^\s*제\s*\d+\s*조(?:\s*의\s*\d+)?/
/** 「제N조」 와 그 뒤 괄호 제목 — 한 줄에 본문까지 붙어 오면 여기까지만 제목이다 */
const CLAUSE_TITLE = /^\s*(제\s*\d+\s*조(?:\s*의\s*\d+)?)\s*([(（【\[][^)）】\]]{1,40}[)）】\]])?\s*(.*)$/
/** 문장으로 끝났나 — 괄호 제목이 없는 줄에서 뒤를 본문으로 내릴지 정한다 */
const SENTENCE_END = /[.。]$|다$/

/**
 * 조항 머리 줄을 제목과 본문 첫 문장으로 가른다.
 * 실측 2026-10-19: 「제2조 (대금 지급) 을은 15일 안에 지급한다.」 한 줄이 통째로 제목이 되어
 * 본문이 비었고, AI로 고치기가 본문에서 그 글을 못 찾아 늘 거절했다.
 * 괄호 제목이 없으면 문장으로 끝날 때만 가른다 — 「제3조 기간」 은 제목 그대로다.
 */
function splitHead(line: string): { title: string; rest: string } {
  const m = CLAUSE_TITLE.exec(line)
  if (!m) return { title: line, rest: '' }
  const [, , paren, rest] = m
  if (!rest) return { title: line, rest: '' }
  if (!paren && !SENTENCE_END.test(rest)) return { title: line, rest: '' }
  // 제목은 원문 글자를 그대로 자른다 — 다시 이어 붙이면 「제1조(목적)」 의 띄어쓰기가 바뀐다
  return { title: line.slice(0, line.length - rest.length).trim(), rest }
}
const PAGE_MARK = /^---\s*\d+쪽\s*---$/

// ------------------------------------------------------------
// 조항 나누기 — AI 없이
// ------------------------------------------------------------

/**
 * 글을 조항으로 나눈다. 「제N조」로 시작하는 줄이 새 조항의 제목이 된다.
 * 첫 조항 앞의 글(계약서 제목과 전문)은 제목 없는 조항 하나로 남긴다 — 버리면 「갑과 을은
 * 다음과 같이 계약한다」 같은 전문이 사라진다. 조항 표시가 하나도 없으면 문단마다 나누지 않고
 * 한 덩어리로 둔다 — 어디서 끊을지 모르면서 끊으면 사람이 다시 붙여야 한다.
 */
export function splitClauses(text: string): Clause[] {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !PAGE_MARK.test(l))
  const groups: { title: string; body: string[] }[] = []
  let cur: { title: string; body: string[] } = { title: '', body: [] }
  for (const line of lines) {
    if (CLAUSE_HEAD.test(line)) {
      if (cur.title || cur.body.length > 0) groups.push(cur)
      const { title, rest } = splitHead(line)
      cur = { title, body: rest ? [rest] : [] }
    } else {
      cur.body.push(line)
    }
  }
  if (cur.title || cur.body.length > 0) groups.push(cur)
  splitSignature(groups)

  const capped = groups.length > MAX_CLAUSES
    ? [...groups.slice(0, MAX_CLAUSES - 1), {
        title: groups[MAX_CLAUSES - 1].title,
        body: groups.slice(MAX_CLAUSES - 1).flatMap((g, i) => (i === 0 ? g.body : [g.title, ...g.body])),
      }]
    : groups

  return capped.map((g, i) => ({
    id: `c${i + 1}`,
    title: g.title,
    html: g.body.length > 0 ? g.body.map((p) => `<p>${escapeHtml(p)}</p>`).join('') : '<p></p>',
    origin: 'template' as const,
  }))
}

/** 날인부 첫 줄 — 띄어쓰기를 걷어 내고 본다(PDF 는 「이상과 같 이」 처럼 글자 사이가 벌어져 온다) */
const SIGN_START = /이상과같이|위와같이|증명하기위하여|기명날인|서명또는날인|서명날인/

/**
 * 날인부를 마지막 조항에서 뗀다.
 * 실측 2026-10-21: 「계약 당사자들은 이상과 같이 … 서명 또는 기명 날인」 부터 甲 乙 줄까지가
 * 제17조(준거법 및 관할) 본문에 붙어 들어왔다. 날인부는 조항이 아니라 계약서 끝의 당사자 표시다.
 * 마지막 「제N조」 안에서만 찾는다 — 본문 중간의 「서면으로 기명날인하여」 를 끊지 않게.
 */
function splitSignature(groups: { title: string; body: string[] }[]): void {
  const last = groups[groups.length - 1]
  if (!last || !CLAUSE_HEAD.test(last.title)) return
  const at = last.body.findIndex((l) => SIGN_START.test(l.replace(/\s+/g, '')))
  if (at < 0) return
  groups.push({ title: '', body: last.body.slice(at) })
  last.body = last.body.slice(0, at)
}

// ------------------------------------------------------------
// 칸 제안 — 받아서 검사하고 바꾼다
// ------------------------------------------------------------

export const SuggestionSchema = z.object({
  suggestions: z.array(z.object({
    clause: z.number().int().min(1),
    text: z.string().min(1).max(300),
    field: z.string().min(1).max(60),
  })).max(200),
})
export type SuggestionDoc = z.infer<typeof SuggestionSchema>
export type Suggestion = SuggestionDoc['suggestions'][number]

export function parseSuggestions(raw: string): SuggestionDoc {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no json object')
  return SuggestionSchema.parse(JSON.parse(raw.slice(start, end + 1)))
}

export type RejectWhy = 'unknown_field' | 'not_in_source' | 'too_short' | 'no_clause' | 'overlap'

export interface ApplyResult {
  clauses: Clause[]
  applied: { clause: number; text: string; field: string; count: number }[]
  rejected: { clause: number; text: string; field: string; why: RejectWhy }[]
}

const LABELS = new Set(CONTRACT_FIELDS.map((f) => f.label))

/**
 * 제안을 원문에 바꿔 넣는다. **원문에 그대로 있는 글자만** 바꾸고, 바꾼 뒤 칸을 원래
 * 글자로 되돌려 원문과 같은지 본다. 하나라도 어긋나면 그 제안은 버린다.
 */
export function applySuggestions(source: Clause[], suggestions: Suggestion[]): ApplyResult {
  const clauses = source.map((c) => ({ ...c }))
  const applied: ApplyResult['applied'] = []
  const rejected: ApplyResult['rejected'] = []
  /** 바꾼 칸과 그 자리의 원래 글자 — 조항마다 */
  const swaps = new Map<number, { token: string; escaped: string }[]>()

  // 긴 글자부터 바꾼다. 「주식회사 가나다」보다 「가나다」를 먼저 바꾸면 앞말만 남는다
  const ordered = [...suggestions].sort((a, b) => b.text.length - a.text.length)
  for (const s of ordered) {
    const idx = s.clause - 1
    const c = clauses[idx]
    if (!c) { rejected.push({ ...s, why: 'no_clause' }); continue }
    if (!LABELS.has(s.field)) { rejected.push({ ...s, why: 'unknown_field' }); continue }
    if (s.text.trim().length < MIN_SUGGESTION_CHARS) { rejected.push({ ...s, why: 'too_short' }); continue }

    const escaped = escapeHtml(s.text)
    const { html: next, count } = replaceInText(c.html, s.text, fieldToken(s.field))
    if (count === 0) { rejected.push({ ...s, why: 'not_in_source' }); continue }
    const token = fieldToken(s.field)
    const list = [...(swaps.get(idx) ?? []), { token, escaped }]
    if (restore(next, list) !== source[idx].html) { rejected.push({ ...s, why: 'overlap' }); continue }

    clauses[idx] = { ...c, html: next }
    swaps.set(idx, list)
    applied.push({ ...s, count })
  }
  return { clauses, applied, rejected }
}

const unescapeHtml = (t: string): string => t
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/**
 * 태그 밖의 글에서만 바꾼다. 「amp」 같은 제안이 `&amp;` 나 `<p>` 안을 건드리면
 * 본문이 깨진다. 이미 넣은 칸(`{{…}}`)의 안쪽도 건드리지 않는다.
 */
export function replaceInText(html: string, text: string, token: string): { html: string; count: number } {
  let count = 0
  const out = html.split(/(<[^>]*>)/).map((seg, i) => {
    if (i % 2 === 1) return seg
    return seg.split(/(\{\{[^{}]*\}\})/).map((piece, j) => {
      if (j % 2 === 1) return piece
      const parts = unescapeHtml(piece).split(text)
      count += parts.length - 1
      return parts.map(escapeHtml).join(token)
    }).join('')
  }).join('')
  return { html: out, count }
}

/** 칸을 원래 글자로 되돌린다 — 나중에 넣은 것부터 */
export function restore(html: string, swaps: { token: string; escaped: string }[]): string {
  return [...swaps].reverse().reduce((h, s) => h.split(s.token).join(s.escaped), html)
}

// ------------------------------------------------------------
// 남은 값 — AI 를 믿지 않고 코드가 한 번 더 본다
// ------------------------------------------------------------

/**
 * 사용자는 **채워진 계약서**를 올린다(「내가 빈걸 넣진 않을거란 말이야」 2026-10-21).
 * 그러니 템플릿에 남은 상호 이름 번호 금액은 전부 다음 계약서에 그대로 인쇄될 남의 값이다.
 * AI 는 확신이 없으면 건너뛰게 되어 있어(프롬프트) 빠뜨린 것이 남는다 — 실측에서 甲 乙 줄과
 * 한글 금액이 그대로 남았다. 그래서 코드가 아는 것은 코드가 바꾸고, 모르는 것은 세어 말한다.
 *
 * - 주민등록번호: 지운다. 저장하지 않는 값이라 칸이 없다 — 생년월일 칸으로 바꾸고 그 앞 이름표도 바꾼다
 * - 우리 회사 값: 설정에 있으니 AI 없이 찾는다. PDF 의 글자 사이 띄어쓰기와 (주) 주식회사 변형까지
 * - 한글 금액: 문서에 하나뿐이면 합계 한글 칸이다. 둘 이상이면 어느 것이 합계인지 몰라 남은 값으로 센다
 * - 그 밖의 번호 금액 날짜: 바꾸지 않고 「남은 값」으로 화면에 알린다
 */

export interface KnownSupplier { name: string; ceo: string; bizNo: string; address: string; phone: string }

export type LeftoverKind = 'phone' | 'bizNo' | 'money' | 'date'

export interface ResidueResult {
  clauses: Clause[]
  /** 코드가 칸으로 바꾼 곳 수(우리 회사 값, 한글 금액) */
  filled: number
  /** 지운 주민등록번호 수 */
  scrubbed: number
  leftover: { clause: number; text: string; kind: LeftoverKind }[]
}

const RRN = /\d{6} *[-–—] *[1-4]\d{6}/g
const RRN_LABEL = /주 *민 *등 *록 *번 *호/g
const HANGUL_AMOUNT = /금 *[일이삼사오육칠팔구십백천만억조][일이삼사오육칠팔구십백천만억조 ]*원 *정?/g
const LEFTOVER: [LeftoverKind, RegExp][] = [
  ['phone', /0\d{1,2} *[-.)] *\d{3,4} *[-.] *\d{4}/g],
  ['bizNo', /\d{3} *- *\d{2} *- *\d{5}/g],
  ['money', /\d{1,3}(?:,\d{3})+ *원|\d+ *만 *원|금 *[일이삼사오육칠팔구십백천만억조][일이삼사오육칠팔구십백천만억조 ]*원 *정?/g],
  ['date', /\d{4} *[년.\-/] *\d{1,2} *[월.\-/] *\d{1,2} *일?/g],
]

const tokenOf = (key: string): string => fieldToken(CONTRACT_FIELDS.find((f) => f.key === key)!.label)
const escapeRe = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** 글자마다 사이 띄어쓰기를 허락한다 — 「이 광 범」 도 「이광범」 이다 */
const spaced = (t: string): string => [...t.replace(/\s+/g, '')].map(escapeRe).join(' *')
/** 숫자만 보고 사이의 띄어쓰기 줄표를 허락한다 */
const digitsOnly = (t: string): string => [...t.replace(/\D/g, '')].join('[ -]*')

const plainOf = (html: string): string =>
  unescapeHtml(html.replace(/<\/p><p>/g, '\n').replace(/<[^>]+>/g, '').replace(/\{\{[^{}]*\}\}/g, '\n'))

/** 상호의 「주식회사」 「(주)」 를 떼고 앞뒤 어느 쪽에 붙어 와도 잡는다 */
function companyPattern(name: string): string | null {
  const core = name.replace(/주식회사|\(주\)|㈜/g, '').trim()
  if (core.replace(/\s+/g, '').length < MIN_SUGGESTION_CHARS) return null
  const corp = '(?:주식회사|\\( *주 *\\)|㈜)'
  return `(?:${corp} *)?${spaced(core)}(?: *${corp})?`
}

function supplierPatterns(k: KnownSupplier): { re: RegExp; key: string }[] {
  const out: { re: string | null; key: string }[] = [
    { re: k.address.trim().length >= 6 ? spaced(k.address) : null, key: 'supplier.address' },
    { re: companyPattern(k.name), key: 'supplier.name' },
    { re: k.bizNo.replace(/\D/g, '').length === 10 ? digitsOnly(k.bizNo) : null, key: 'supplier.bizNo' },
    { re: k.phone.replace(/\D/g, '').length >= 8 ? digitsOnly(k.phone) : null, key: 'supplier.phone' },
    { re: k.ceo.replace(/\s+/g, '').length >= MIN_SUGGESTION_CHARS ? spaced(k.ceo) : null, key: 'supplier.ceo' },
  ]
  return out.filter((p): p is { re: string; key: string } => p.re !== null).map((p) => ({ re: new RegExp(p.re, 'g'), key: p.key }))
}

/** 글에서 정규식이 잡은 글자를 그대로 칸으로 바꾼다. 바꾼 곳 수를 낸다 */
function replaceMatches(html: string, re: RegExp, token: string): { html: string; count: number } {
  let out = html
  let count = 0
  const hits = [...new Set([...plainOf(html).matchAll(re)].map((m) => m[0].trim()))].sort((a, b) => b.length - a.length)
  for (const hit of hits) {
    const r = replaceInText(out, hit, token)
    out = r.html
    count += r.count
  }
  return { html: out, count }
}

/**
 * 주민등록번호를 지운다 — **AI 에 보내기 전에.**
 * 실측 2026-10-21: 지우기를 AI 뒤에 두자 AI 가 앞자리 「800101」 만 생년월일 칸으로 짚어
 * 뒷자리 「– 1234567」 이 남았고, 온전한 13자리를 찾는 패턴은 그것을 못 봤다. AI 가 못 보게 먼저 지운다.
 */
export function scrubRrn(source: Clause[]): { clauses: Clause[]; scrubbed: number } {
  let scrubbed = 0
  const clauses = source.map((c) => {
    const rrn = replaceMatches(c.html, RRN, tokenOf('customer.birth'))
    if (rrn.count === 0) return c
    scrubbed += rrn.count
    return { ...c, html: replaceMatches(rrn.html, RRN_LABEL, CONTRACT_FROM_FILE.birthLabel).html }
  })
  return { clauses, scrubbed }
}

export function scrubResidue(source: Clause[], known: KnownSupplier | null): Omit<ResidueResult, 'scrubbed'> {
  let filled = 0
  let clauses = source.map((c) => {
    let html = c.html
    for (const p of known ? supplierPatterns(known) : []) {
      const r = replaceMatches(html, p.re, tokenOf(p.key))
      html = r.html
      filled += r.count
    }
    return { ...c, html }
  })

  const amounts = new Set(clauses.flatMap((c) => [...plainOf(c.html).matchAll(HANGUL_AMOUNT)].map((m) => m[0].replace(/\s+/g, ''))))
  if (amounts.size === 1) {
    clauses = clauses.map((c) => {
      const r = replaceMatches(c.html, HANGUL_AMOUNT, tokenOf('quote.totalInWords'))
      filled += r.count
      return { ...c, html: r.html }
    })
  }

  const leftover: ResidueResult['leftover'] = []
  clauses.forEach((c, i) => {
    const text = plainOf(c.html)
    for (const [kind, re] of LEFTOVER) {
      for (const m of text.matchAll(re)) leftover.push({ clause: i + 1, text: m[0].trim(), kind })
    }
  })
  return { clauses, filled, leftover }
}

// ------------------------------------------------------------
// 파일 읽기와 AI
// ------------------------------------------------------------

export interface ContractFileInput {
  fileName: string
  mimeType: string | null
  bytes: Uint8Array
}

export type AiOutcome = { status: 'ok' } | { status: 'failed'; message: string }

export interface ContractFileDraft {
  name: string
  clauses: Clause[]
  applied: ApplyResult['applied']
  rejected: ApplyResult['rejected']
  /** 코드가 칸으로 바꾼 곳 수, 지운 주민등록번호 수, 칸으로 못 바꾸고 남은 값 */
  filled: number
  scrubbed: number
  leftover: ResidueResult['leftover']
  ai: AiOutcome
  truncated: boolean
  runId: string | null
  /** 원본을 버킷에 남길 때 쓸 형식 — 매직바이트로 판정한 종류에서 정한다. 모르면 null */
  sourceMime: string | null
}

const OOXML_MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
const ODF_MIME: Record<string, string> = {
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
}

/**
 * 원본 파일을 남길 형식. **브라우저가 붙인 형식을 믿지 않는다** — 한글 파일은 빈 값이나
 * octet-stream 으로 오고, 텍스트는 text/plain 으로 와서 버킷이 거절했다(F-10 실측).
 * 매직바이트로 판정한 종류에서 정하고, 텍스트는 html 이어도 text/plain 으로 남긴다(열어도 그려지지 않게).
 */
export function sourceMimeOf(kind: DetectedKind, fileName: string): string | null {
  const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  switch (kind) {
    case 'pdf': return 'application/pdf'
    case 'hwp': return 'application/x-hwp'
    case 'hwpx': return 'application/hwp+zip'
    case 'rtf': return 'application/rtf'
    case 'text': return 'text/plain'
    case 'ooxml': return OOXML_MIME[ext] ?? null
    case 'odf': return ODF_MIME[ext] ?? null
    default: return null
  }
}

/** 파일 이름에서 템플릿 이름을 — 확장자를 떼고 길이를 자른다 */
export function nameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim()
  return (base || CONTRACT_FROM_FILE.defaultName).slice(0, 100)
}

/** 파일을 읽어 조항 글을 얻는다. 글자가 없으면 이유를 말하고 멈춘다 */
async function readContractText(input: ContractFileInput): Promise<{ text: string; truncated: boolean; kind: DetectedKind }> {
  const check = checkQuoteFile(input)
  if (!check.ok) {
    throw new CrmError('VALIDATION_FAILED', CONTRACT_FROM_FILE.reject[check.reason], {
      field: 'file', reason: check.reason, detail: check.detail,
    })
  }
  if (check.kind === 'image') {
    throw new CrmError('VALIDATION_FAILED', CONTRACT_FROM_FILE.imageNotSupported, { field: 'file' })
  }
  const parsed = await parseFile({
    fileId: `contract-${Date.now()}`, fileName: input.fileName, bytes: input.bytes, fileRole: 'contract',
  })
  if (!parsed.ok) {
    throw new CrmError('VALIDATION_FAILED', CONTRACT_FROM_FILE.parseFailed,
      { field: 'file', reason: parsed.reason, detail: parsed.detail })
  }
  const read = irToSourceText(parsed.doc, { maxChars: MAX_CONTRACT_SOURCE_CHARS })
  if (read.text.trim().length === 0) {
    throw new CrmError('VALIDATION_FAILED', CONTRACT_FROM_FILE.noText, { field: 'file' })
  }
  return { text: read.text, truncated: read.truncated, kind: check.kind }
}

/** AI 에 보낼 글 — 조항 번호를 붙여 어느 조항의 글자인지 말할 수 있게 한다 */
export function promptInputOf(clauses: Clause[]): string {
  const strip = (h: string) => unescapeHtml(h.replace(/<\/p><p>/g, '\n').replace(/<[^>]+>/g, ''))
  return clauses.map((c, i) => `[조항 ${i + 1}] ${c.title}\n${strip(c.html)}`).join('\n\n')
}

/** 칸 자리를 짚어 주는 쪽 — 운영에서는 runAi, 시험에서는 가짜 */
export type Suggest = (clauses: Clause[]) => Promise<{ suggestions: Suggestion[]; runId: string | null }>

/**
 * 읽은 글 → 템플릿 초안. 조항은 코드가 나누고, 칸은 `suggest` 가 짚은 것 가운데 검사를 지난 것만 넣는다.
 */
export async function buildDraft(
  read: { fileName: string; text: string; truncated: boolean; kind?: DetectedKind }, suggest: Suggest,
  known: KnownSupplier | null = null,
): Promise<ContractFileDraft> {
  const { clauses: base, scrubbed } = scrubRrn(splitClauses(read.text))
  const name = nameFromFile(read.fileName)
  const sourceMime = read.kind ? sourceMimeOf(read.kind, read.fileName) : null
  try {
    const { suggestions, runId } = await suggest(base)
    const done = applySuggestions(base, suggestions)
    const residue = scrubResidue(done.clauses, known)
    return { name, ...done, ...residue, scrubbed, ai: { status: 'ok' }, truncated: read.truncated, runId, sourceMime }
  } catch (e) {
    /*
      **글은 이미 읽었다.** AI 가 못 했다고 파일 올리기 전체를 실패로 돌리면
      사람은 같은 파일을 다시 올리고 같은 실패를 본다. 칸 없이 글만 들이고 그 사실을 말한다.
      예산이 막혔거나 키가 없으면 러너가 사람에게 할 말(CrmError)을 이미 만들어 둔다.
    */
    const message = e instanceof CrmError ? e.message : CONTRACT_FROM_FILE.aiFailed
    // AI 가 못 해도 주민등록번호 지우기와 우리 회사 값 바꾸기는 한다 — 코드가 아는 일이다
    return {
      name, ...scrubResidue(base, known), scrubbed, applied: [], rejected: [],
      ai: { status: 'failed', message }, truncated: read.truncated, runId: null, sourceMime,
    }
  }
}

/**
 * 파일 → 템플릿 초안. 저장은 하지 않는다 — 부르는 쪽이 템플릿을 만들고 원본을 첨부로 남긴다.
 * AI 는 runAi 를 지난다 — 개인정보 가림, 예산, 원장이 거기 있다.
 */
export async function draftTemplateFromFile(
  db: CrmDb, workspaceId: string, actorId: string | null, input: ContractFileInput, adapter?: AiAdapter,
): Promise<ContractFileDraft> {
  const { text, truncated, kind } = await readContractText(input)
  const known = await readQuoteSupplier(db)
  return buildDraft({ fileName: input.fileName, text, truncated, kind }, async (base) => {
    const chosen = adapter ?? await adapterFromSetting(db, { actorId })
    const { output, runId } = await runAi<SuggestionDoc>({
      actorId, db, workspaceId, kind: 'QUICK_CREATE',
      prompt: CONTRACT_TEMPLATE_FROM_DOC_V1,
      input: promptInputOf(base),
      inputRef: { fileName: input.fileName, clauses: base.length, chars: text.length },
      parse: parseSuggestions,
      adapter: chosen,
    })
    return { suggestions: output.suggestions, runId }
  }, known)
}
