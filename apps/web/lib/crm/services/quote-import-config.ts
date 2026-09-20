/**
 * 견적서 파일 읽기 설정 — **숫자를 코드에 박지 않는다**
 *
 * ## 왜 설정인가
 *
 * 여기 있는 다섯은 전부 「얼마나 읽을까」와 「어디까지 보여 줄까」다. 그런데 그 답은
 * 회사마다 다르다. 부속명세가 열 장 붙는 견적서를 다루는 곳과 한 장짜리만 쓰는 곳이
 * 같은 상한을 쓸 이유가 없다. 코드에 박으면 바꾸려고 **배포를 기다려야 한다**
 * (`setting.ts` 머리말의 그 이유와 같다).
 *
 * ## 망가진 설정이 읽기를 멈추지 않는다
 *
 * 상한 칸에 빈 값이나 「많이」가 들어오면 **기본값으로 떨어진다.** 0 을 그대로 쓰면
 * 그날부터 모든 견적서가 항목 0 건으로 읽히고, 화면은 「항목을 못 찾았어요」라고 말한다.
 * 사용자는 설정을 건드린 것과 그 화면을 잇지 못한다.
 *
 * 위쪽 상한도 둔다. 「999999」가 들어오면 견적서 한 장을 읽는 데 모델 호출이 통째로
 * 날아간다 — 상한은 사람이 실수해도 시스템이 버티는 자리지, 사람 말을 그대로 따르는 자리가 아니다.
 *
 * ## 값은 한 곳에서만 온다
 *
 * 기본값은 이미 코드에 있던 상수를 그대로 가리킨다. 여기에 숫자를 또 적으면
 * 둘이 갈리고, 그때 어느 쪽이 진짜인지 판정할 방법이 없다.
 */

import type { CrmDb } from '../db/client.ts'
import { MAX_SOURCE_CHARS } from './quote-source-text.ts'
import { MAX_DOC_LINES } from '../ai/schemas/quote-from-doc.ts'
import { QUOTE_IMPORT_SETTING_KEY } from '../../terms/quote.ts'

/** 견적서에 구성을 어떻게 인쇄할까 */
export type PrintComponents = 'expand' | 'collapse'

export interface QuoteImportConfig {
  /** 항목 하나에 딸릴 구성 줄 수 상한 */
  maxComponentLines: number
  /** 한 건에서 받을 항목 수 상한 */
  maxLines: number
  /** 모델에 넘길 원문 글자 수 상한 */
  maxChars: number
  /** 파일에서 견적을 만들 때 그 건의 쪽을 그림으로 굳혀 붙이나 */
  snapshot: boolean
  /** 견적서 인쇄에서 구성을 펴나 접나 */
  printComponents: PrintComponents
}

/**
 * 설정이 하나도 없을 때 시스템이 도는 값.
 *
 * 둘은 **이미 있던 상수를 그대로 가리킨다** — 숫자를 여기 또 적으면 두 곳이 갈린다.
 */
export const QUOTE_IMPORT_FALLBACK: QuoteImportConfig = {
  maxComponentLines: 40,
  maxLines: MAX_DOC_LINES,
  maxChars: MAX_SOURCE_CHARS,
  snapshot: true,
  printComponents: 'expand',
}

/** 사람이 실수해도 시스템이 버티는 위쪽 상한 */
export const QUOTE_IMPORT_CEILING = {
  maxComponentLines: 200,
  maxLines: 1_000,
  maxChars: 200_000,
} as const

/**
 * 숫자 설정 하나를 읽는다.
 *
 * **0 과 빈 값과 글자는 전부 기본값으로 떨어진다.** 0 을 그대로 쓰면 그날부터
 * 모든 견적서가 0 건으로 읽히고, 화면은 파일을 못 읽었다고 말한다.
 */
export function parseLimit(raw: unknown, fallback: number, ceiling: number): number {
  const t = String(raw ?? '').replace(/[,\s]/g, '')
  if (t === '') return fallback
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), ceiling)
}

/** 켜고 끄는 설정 하나. 「on」만 켠 것이고 빈 값은 기본값이다 */
export function parseToggle(raw: unknown, fallback: boolean): boolean {
  const t = String(raw ?? '').trim().toLowerCase()
  if (t === '') return fallback
  return t === 'on' || t === 'true' || t === '1'
}

/** 고른 값이 아는 값이 아니면 기본값으로 */
export function parsePrintComponents(raw: unknown, fallback: PrintComponents): PrintComponents {
  const t = String(raw ?? '').trim().toLowerCase()
  return t === 'expand' || t === 'collapse' ? t : fallback
}

/** 설정 키 → 저장된 값. DB 를 모르므로 시험이 쉽다 */
export type QuoteImportRaw = Partial<Record<string, unknown>>

/**
 * 저장된 값들을 설정으로 푼다. **DB 를 모른다** — 이 함수가 순수해야
 * 「0 을 넣으면 어떻게 되나」를 운영 DB 없이 시험할 수 있다.
 */
export function toQuoteImportConfig(raw: QuoteImportRaw): QuoteImportConfig {
  const f = QUOTE_IMPORT_FALLBACK
  return {
    maxComponentLines: parseLimit(
      raw[QUOTE_IMPORT_SETTING_KEY.maxComponentLines], f.maxComponentLines, QUOTE_IMPORT_CEILING.maxComponentLines),
    maxLines: parseLimit(
      raw[QUOTE_IMPORT_SETTING_KEY.maxLines], f.maxLines, QUOTE_IMPORT_CEILING.maxLines),
    maxChars: parseLimit(
      raw[QUOTE_IMPORT_SETTING_KEY.maxChars], f.maxChars, QUOTE_IMPORT_CEILING.maxChars),
    snapshot: parseToggle(raw[QUOTE_IMPORT_SETTING_KEY.snapshot], f.snapshot),
    printComponents: parsePrintComponents(raw[QUOTE_IMPORT_SETTING_KEY.printComponents], f.printComponents),
  }
}

/**
 * 다섯을 **한 번에** 읽는다.
 *
 * 키마다 조회를 따로 하면 견적서 한 장을 읽는 데 조회가 다섯 번이고,
 * 견적 목록에서 미리보기를 그리면 그게 그대로 곱해진다(`readQuoteImages` 와 같은 이유).
 */
export async function readQuoteImportConfig(db: CrmDb): Promise<QuoteImportConfig> {
  const keys = Object.values(QUOTE_IMPORT_SETTING_KEY)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmAppSetting.findMany({
    where: { key: { in: keys } },
    select: { scope: true, key: true, valueJson: true },
  }) as { scope: 'GLOBAL' | 'WORKSPACE'; key: string; valueJson: unknown }[]

  const raw: QuoteImportRaw = {}
  for (const key of keys) {
    const mine = rows.filter((r) => r.key === key)
    // 워크스페이스 값이 공통 값을 덮는다 — 두 층 규칙은 설정 체계 전체와 같다
    const hit = mine.find((r) => r.scope === 'WORKSPACE') ?? mine.find((r) => r.scope === 'GLOBAL')
    if (hit) raw[key] = hit.valueJson
  }
  return toQuoteImportConfig(raw)
}
