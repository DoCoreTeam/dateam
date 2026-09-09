/**
 * 회사 프로필 초안 — 규칙이 먼저 풀고 **AI 는 남은 것만** (사용자 개입)
 *
 * ## 왜 필요한가
 *
 * 규칙(`draft.ts`)이 뽑는 것은 정규식으로 잡히는 것뿐이다 — 사업자번호·자본금·매출·
 * 인원·소재지·인증 이름·표로 된 실적. 그런데 **회사 이름조차 못 뽑는다**(어느 정규식으로
 * 회사 이름을 잡겠나). 기술·협력사·문장으로 흩어진 실적도 마찬가지다.
 * 그래서 회사소개서를 올려도 화면이 거의 비어 있었다.
 *
 * ## 공고 분석과 같은 기계를 쓴다
 *
 * 프롬프트·근거 붙이기·JSON 회수는 `analyze/parse-fields` 와 같은 방식이다.
 * 다르게 만들면 한쪽만 좋아지고 다른 쪽은 그대로 남는다.
 *
 * ## 규칙이 푼 칸은 안 건드린다
 *
 * AI 가 이미 확정된 값을 덮으면, 확실한 것(정규식으로 잡힌 사업자번호)을
 * 불확실한 것(추측)으로 바꾸는 셈이다.
 */

import { recoverJson, asJsonRecord } from '../../ai/json-recover.ts'
import type { CompanyProfile } from './profile.ts'
import type { DraftEvidence } from './draft.ts'
import type { IrDocument } from '../ir/types.ts'

/** AI 에게 물을 칸 — 규칙이 못 푸는 것들만 */
export const AI_FIELDS = ['companyName', 'trackRecords', 'capabilities', 'partners'] as const
export type AiField = (typeof AI_FIELDS)[number]

/** 프롬프트에 넣을 원문 길이 상한. 회사소개서 전체를 넣으면 비용이 문서 크기에 비례한다 */
export const MAX_PROMPT_CHARS = 40_000

/** 한 번에 받아들일 줄 수 — 넘치면 사람이 확인을 포기한다 */
export const MAX_ROWS = 30

export interface AiDraftInput {
  docs: readonly IrDocument[]
  /** 규칙이 이미 푼 것 — 여기 있는 칸은 안 묻는다 */
  filled: CompanyProfile
}

export interface AiDraftResult {
  patch: Partial<Pick<CompanyProfile, 'certifications' | 'trackRecords' | 'capabilities' | 'partners'>>
  companyName: string | null
  evidence: DraftEvidence[]
}

/** 아직 안 채워진 칸 — 이것만 묻는다 */
export function unfilled(filled: CompanyProfile): AiField[] {
  const out: AiField[] = []
  if (!filled.basic.companyName.trim()) out.push('companyName')
  if (filled.trackRecords.length === 0) out.push('trackRecords')
  if (filled.capabilities.length === 0) out.push('capabilities')
  if (filled.partners.length === 0) out.push('partners')
  return out
}

/** 원문을 프롬프트로 — 블록 ID 를 붙여야 근거가 원문으로 돌아온다 */
export function renderDocs(docs: readonly IrDocument[], limit = MAX_PROMPT_CHARS): string {
  const lines: string[] = []
  let used = 0
  for (const d of docs) {
    for (const b of d.blocks) {
      const text = b.text.trim()
      if (!text) continue
      const line = `[${b.blockId}] ${text}`
      if (used + line.length > limit) return lines.join('\n')
      lines.push(line)
      used += line.length
    }
  }
  return lines.join('\n')
}

export function buildPrompt(fields: readonly AiField[], body: string): string {
  return [
    '아래는 우리 회사 소개 문서다. 다음 값을 뽑는다.',
    `뽑을 값: ${fields.join(', ')}`,
    '',
    '지켜야 할 규칙',
    '1. 원문에 없는 내용을 만들지 않는다',
    '2. 값마다 근거로 삼은 블록 ID 를 적는다',
    '3. 못 찾은 값은 null 또는 빈 배열로 둔다',
    '4. 금액은 원 단위 숫자로 적는다',
    '5. 날짜는 ISO 8601 로 적는다',
    '',
    '아래 JSON 하나만 답한다. 다른 말을 덧붙이지 않는다.',
    '{',
    '  "companyName": { "value": null, "blockId": null },',
    '  "trackRecords": [{ "projectName": "", "client": null, "amountKrw": null, "startDate": null, "endDate": null, "domainTags": [], "blockId": null }],',
    '  "capabilities": [{ "tag": "", "level": 3, "blockId": null }],',
    '  "partners": [{ "name": "", "capabilities": [], "blockId": null }]',
    '}',
    '',
    '원문',
    body,
  ].join('\n')
}

/**
 * 모델의 답을 프로필 조각으로 옮긴다.
 *
 * 모양이 안 맞는 줄은 버린다 — 억지로 채우면 사람이 「이건 뭐지」 하는 줄이 늘고,
 * 그 줄이 늘수록 확인 자체를 포기한다.
 */
export function parseAiDraft(text: string, fields: readonly AiField[]): AiDraftResult {
  const empty: AiDraftResult = { patch: {}, companyName: null, evidence: [] }
  let parsed: unknown
  try {
    parsed = recoverJson(text)
  } catch {
    return empty
  }

  const body = asJsonRecord(parsed)
  const evidence: DraftEvidence[] = []
  const out: AiDraftResult = { patch: {}, companyName: null, evidence }
  const want = new Set(fields)

  if (want.has('companyName')) {
    const cell = asJsonRecord(body.companyName)
    const name = str(cell.value) ?? str(body.companyName)
    if (name) {
      out.companyName = name.slice(0, 200)
      const blockId = str(cell.blockId)
      if (blockId) evidence.push({ field: 'basic.companyName', blockId, quote: name })
    }
  }

  if (want.has('trackRecords')) {
    const rows = list(body.trackRecords).map((r) => {
      const x = asJsonRecord(r)
      const projectName = str(x.projectName)
      if (!projectName) return null
      const blockId = str(x.blockId)
      if (blockId) evidence.push({ field: 'trackRecords', blockId, quote: projectName })
      return {
        projectName,
        client: str(x.client),
        amountKrw: num(x.amountKrw),
        startDate: str(x.startDate),
        endDate: str(x.endDate),
        domainTags: strList(x.domainTags),
      }
    }).filter(isSome).slice(0, MAX_ROWS)
    if (rows.length > 0) out.patch.trackRecords = rows
  }

  if (want.has('capabilities')) {
    const rows = list(body.capabilities).map((r) => {
      const x = asJsonRecord(r)
      const tag = str(x.tag)
      if (!tag) return null
      const blockId = str(x.blockId)
      if (blockId) evidence.push({ field: 'capabilities', blockId, quote: tag })
      // 표가 1~5 로 제약한다. 밖의 값을 넣으면 저장이 통째로 실패한다
      return { tag, level: Math.min(5, Math.max(1, Math.round(num(x.level) ?? 3))) }
    }).filter(isSome).slice(0, MAX_ROWS)
    if (rows.length > 0) out.patch.capabilities = rows
  }

  if (want.has('partners')) {
    const rows = list(body.partners).map((r) => {
      const x = asJsonRecord(r)
      const name = str(x.name)
      if (!name) return null
      const blockId = str(x.blockId)
      if (blockId) evidence.push({ field: 'partners', blockId, quote: name })
      return { name, capabilities: strList(x.capabilities) }
    }).filter(isSome).slice(0, MAX_ROWS)
    if (rows.length > 0) out.patch.partners = rows
  }

  return out
}

/** 규칙 결과 위에 AI 결과를 얹는다 — **규칙이 푼 칸은 안 건드린다** */
export function mergeDraft(filled: CompanyProfile, ai: AiDraftResult): CompanyProfile {
  return {
    ...filled,
    basic: {
      ...filled.basic,
      companyName: filled.basic.companyName.trim() || (ai.companyName ?? ''),
    },
    trackRecords: filled.trackRecords.length > 0 ? filled.trackRecords : (ai.patch.trackRecords ?? []),
    capabilities: filled.capabilities.length > 0 ? filled.capabilities : (ai.patch.capabilities ?? []),
    partners: filled.partners.length > 0 ? filled.partners : (ai.patch.partners ?? []),
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[^0-9.-]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim()) : []
}
function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function isSome<T>(v: T | null): v is T {
  return v !== null
}
