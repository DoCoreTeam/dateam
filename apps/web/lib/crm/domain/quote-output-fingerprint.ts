/**
 * 견적서 출력 지문 — 「견적서가 한 글자도 안 바뀌었다」를 숫자로 말하는 장치
 *
 * **왜 있나**: 계약서를 붙이며 견적 화면을 다시 짠다(P0132). 사용자 지시는
 * 「지금 데이터가 문제 생긴다거나 출력물이 달라진다거나 이건 안된다」였다.
 * 눈으로 보고 「같아 보인다」고 하면 그 말은 근거가 없다. 그래서 견적서를 만드는
 * 두 재료를 지문으로 묶는다.
 *
 *   1) 문서 조립 결과(`getQuoteDocument` 가 돌려주는 것 전부) — 종이, 엑셀, PDF 가 다 이것을 읽는다
 *   2) 그 결과를 종이로 그리는 코드의 글자 — 같은 재료라도 그리는 코드가 바뀌면 출력이 바뀐다
 *
 * 둘 다 같으면 출력도 같다. 하나라도 다르면 어느 견적에서 달라졌는지 이름을 댄다.
 *
 * 순수 함수만 둔다. DB 를 읽는 쪽은 `scripts/quote-output-fingerprint.ts` 다.
 */

import { createHash } from 'node:crypto'

/**
 * 키 순서와 상관없이 같은 값이면 같은 글자가 되게 편다.
 * bigint 는 JSON 이 못 싣으므로 글자로 바꾸고, undefined 칸은 JSON 과 같이 뺀다.
 */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'bigint') return JSON.stringify(`${value.toString()}n`)
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** 견적 한 건의 문서 재료 지문 */
export function fingerprintDocument(result: unknown): string {
  return sha256(stableStringify(result))
}

export interface FingerprintEntry {
  quoteId: string
  hash: string
}

export interface FingerprintSet {
  /** 그리는 코드의 지문 — 파일 경로마다 하나 */
  renderers: Record<string, string>
  quotes: FingerprintEntry[]
}

export interface FingerprintDiff {
  /** 기준선에만 있고 지금은 없는 견적 */
  missing: string[]
  /** 지금만 있는 견적 (새로 만든 견적) */
  added: string[]
  /** 둘 다 있는데 지문이 다른 견적 */
  changed: string[]
  /** 그리는 코드가 바뀐 파일 */
  renderersChanged: string[]
}

/**
 * 기준선과 지금을 견준다.
 *
 * **새로 생긴 견적은 「바뀜」이 아니다.** 시험이나 사람이 그 사이 견적을 만들 수 있다 —
 * 지키는 것은 「있던 견적서가 그대로인가」다. 그래서 added 는 따로 알리기만 한다.
 */
export function compareFingerprints(base: FingerprintSet, now: FingerprintSet): FingerprintDiff {
  const nowMap = new Map(now.quotes.map((q) => [q.quoteId, q.hash]))
  const baseIds = new Set(base.quotes.map((q) => q.quoteId))
  const missing: string[] = []
  const changed: string[] = []
  for (const q of base.quotes) {
    const h = nowMap.get(q.quoteId)
    if (h === undefined) missing.push(q.quoteId)
    else if (h !== q.hash) changed.push(q.quoteId)
  }
  const added = now.quotes.filter((q) => !baseIds.has(q.quoteId)).map((q) => q.quoteId)
  const renderersChanged = Object.keys(base.renderers)
    .filter((p) => base.renderers[p] !== now.renderers[p])
  return { missing, added, changed, renderersChanged }
}

/** 출력이 그대로인가 — 있던 것이 사라졌거나 바뀌었거나 그리는 코드가 바뀌면 아니다 */
export function isOutputUnchanged(diff: FingerprintDiff): boolean {
  return diff.missing.length === 0 && diff.changed.length === 0 && diff.renderersChanged.length === 0
}
