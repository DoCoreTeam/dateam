/**
 * 소스 분석 정책 — **원문을 버리지 않는다**
 *
 * ## 왜 원문을 남기나
 *
 * 분석이 틀렸거나 모델이 바뀌면 다시 분석해야 한다. 요약만 남기고 원문을 버리면
 * 다시 할 수가 없고, 「그 자료에 정말 그렇게 적혀 있었나」를 물을 수도 없다.
 * 요약은 파생이고 원문이 사실이다.
 *
 * ## 왜 내용으로 짝을 짓나
 *
 * 같은 글을 두 번 넣으면 주소가 달라도 같은 자료다. 주소로 짝을 지으면 같은 문서를
 * 열 번 분석하고 AI 예산을 열 배 쓴다. 그래서 **내용 해시**가 유일 키다.
 *
 * ## 밖으로 나가는 요청 (보안 S4)
 *
 * 주소를 사람이 준다. 그대로 `fetch` 하면 사설망이나 클라우드 메타데이터 주소를 물린다.
 * `lib/security/safe-fetch` 를 지나고, 이 모듈에는 `fetch` 가 없다 — 가드가 센다.
 */

import { createHash } from 'node:crypto'

export const SOURCE_KINDS = ['text', 'url', 'upload'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

/** 원문 상한. 넘으면 **던지지 않고 자르고 센다** — 긴 문서 하나가 그 실행을 죽이면 안 된다 */
export const MAX_RAW_LENGTH = 200_000

export interface SourceInput {
  kind: SourceKind
  /** 무엇을 가리키나. url 이면 주소, text 면 사람이 붙인 이름 */
  ref: string
  rawText: string
}

export type SourceRejection = { reason: string; userMessage: string }

/**
 * 내용 해시. **본문만** 넣는다 — 주소를 섞으면 같은 글이 주소마다 다른 자료가 된다.
 *
 * 공백을 다듬어서 센다. 붙여넣기할 때마다 줄바꿈이 달라지는데 그것을 다른 글로 보면
 * 같은 문서를 계속 다시 분석한다.
 */
export function contentHash(rawText: string): string {
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}

export function normalizeSource(input: SourceInput): { source: SourceInput; truncated: number } {
  const raw = input.rawText.replace(/\r\n/g, '\n')
  const truncated = Math.max(0, raw.length - MAX_RAW_LENGTH)
  return {
    source: { ...input, ref: input.ref.trim(), rawText: raw.slice(0, MAX_RAW_LENGTH) },
    truncated,
  }
}

export function validateSource(input: SourceInput): SourceRejection | null {
  if (input.rawText.trim() === '') {
    return { reason: 'empty_text', userMessage: '자료가 비어 있습니다' }
  }
  if (input.ref.trim() === '') {
    return { reason: 'empty_ref', userMessage: '자료가 어디서 왔는지 적어 주세요' }
  }
  return null
}

export interface SourceFinding {
  claim: string
  /** 원문의 어느 부분인가. 없으면 지어낸 것이다 */
  quote: string
}

export interface SourceAnalysis {
  summary: string
  findings: SourceFinding[]
}

/**
 * AI 응답을 읽는다.
 *
 * 인용이 없는 주장은 버린다 — 원문에 없는 말이 「이 자료에 따르면」으로 화면에 뜨면,
 * 사람은 그것을 자료로 읽는다.
 */
export function parseAnalysis(raw: unknown): SourceAnalysis | SourceRejection {
  if (typeof raw !== 'object' || raw === null) {
    return { reason: 'not_an_object', userMessage: 'AI 응답을 읽지 못했습니다' }
  }
  const o = raw as Record<string, unknown>
  const summary = typeof o.summary === 'string' ? o.summary.trim() : ''
  if (summary === '') {
    return { reason: 'empty_summary', userMessage: 'AI 가 요약을 내지 못했습니다' }
  }
  const rawFindings = Array.isArray(o.findings) ? o.findings : []
  const findings: SourceFinding[] = rawFindings.flatMap((f) => {
    if (typeof f !== 'object' || f === null) return []
    const r = f as Record<string, unknown>
    const claim = typeof r.claim === 'string' ? r.claim.trim() : ''
    const quote = typeof r.quote === 'string' ? r.quote.trim() : ''
    // 인용 없는 주장은 자료가 아니다
    if (claim === '' || quote === '') return []
    return [{ claim, quote }]
  })
  return { summary, findings }
}

/** 인용이 정말 원문에 있나. 없으면 그 주장은 버린다 */
export function keepGroundedFindings(
  analysis: SourceAnalysis, rawText: string,
): { kept: SourceFinding[]; dropped: number } {
  const hay = rawText.replace(/\s+/g, ' ')
  const kept = analysis.findings.filter((f) => hay.includes(f.quote.replace(/\s+/g, ' ')))
  return { kept, dropped: analysis.findings.length - kept.length }
}

export function isSourceRejection(v: SourceAnalysis | SourceRejection): v is SourceRejection {
  return 'reason' in v
}

export function buildSourcePrompt(ref: string, rawText: string): string {
  return [
    '너는 선물 트레이딩 자료를 읽고 정리하는 사람이다.',
    '',
    '규칙',
    '- 아래 자료에 **적혀 있는 것만** 쓴다',
    '- 주장마다 자료에서 그대로 옮긴 문장을 quote 에 넣는다. 못 찾으면 그 주장을 빼라',
    '- 예측하거나 권하지 않는다',
    '- 자료에 없는 숫자를 쓰지 않는다',
    '',
    `자료 출처: ${ref}`,
    '자료',
    '---',
    rawText,
    '---',
    '',
    'JSON 으로만 답한다:',
    '{"summary": "...", "findings": [{"claim": "...", "quote": "자료에서 그대로 옮긴 문장"}]}',
  ].join('\n')
}
