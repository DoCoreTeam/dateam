/**
 * 이미지에서 글자 뽑기 (설계서 3.3.2)
 *
 * ## 별도 OCR 엔진을 기본으로 두지 않는 이유
 *
 * 공공 RFP 는 대부분 디지털 원본이라 텍스트 레이어가 있다. 그런데도 이미지 처리가 필요한
 * 자리가 셋 남는다 — **표를 그림으로 붙여 넣은 문서**, **관인 찍힌 스캔 공고문**,
 * **첨부된 사업자등록증·인증서**. 이 셋은 «글자 모양 읽기»가 아니라 «표와 서식을 읽어
 * 뜻으로 옮기기»에 가깝고, 그건 멀티모달 모델이 전용 OCR 엔진보다 잘한다.
 *
 * 그래서 **기본 경로가 멀티모달 모델**이고, 별도 엔진은 문서 등급 때문에 외부로 못 보낼 때만
 * 쓰는 폴백이다. 엔진을 기본으로 두면 잘 읽는 길을 두고 못 읽는 길로 늘 다니게 된다.
 *
 * ## 이미 글자가 있는 쪽은 부르지 않는다
 *
 * 텍스트 레이어가 있는 쪽까지 모델에 보내면 비용이 쪽 수에 비례해 늘고, 더 나쁘게는
 * **원문에 있는 글을 모델이 다시 쓴 글로 덮는다.** 근거의 출처가 원문이 아니게 된다.
 */

import type { DocClass } from '../domain/doc-class.ts'
import type { TransferDecision } from '../domain/doc-class.ts'
import type { IrBlock, IrDocument, IrFigure } from '../ir/types.ts'
import { makeBlock } from '../ir/build.ts'
import { MIN_CHARS_PER_TEXT_PAGE } from './office.ts'

// ── 경로 고르기 ──────────────────────────────────────────────

export type ImageTextRoute =
  /** 기본 — 멀티모달 모델이 그림째 읽는다 */
  | 'multimodal'
  /** 폴백 — 사내에 둔 텍스트화 엔진. 등급 때문에 밖으로 못 보낼 때만 */
  | 'ocr_engine'
  /** 어느 길도 없다. 사람이 원문을 봐야 한다 */
  | 'blocked'

export type RouteReason =
  | 'default_multimodal'
  | 'external_blocked_by_doc_class'
  | 'no_local_engine'

export interface RouteInput {
  docClass: DocClass
  /** 게이트웨이가 이 문서를 이 모델로 보내도 되는지 판정한 결과 */
  transfer: TransferDecision
  /** 사내에서 돌리는 텍스트화 엔진이 등록돼 있나 */
  hasLocalEngine: boolean
}

export interface RouteDecision {
  route: ImageTextRoute
  reason: RouteReason
}

/**
 * 어느 길로 읽을지 정한다.
 *
 * 등급이 길을 막을 때만 폴백으로 내려간다 — 폴백을 기본으로 올리면
 * 공개 문서까지 성능이 낮은 길로 다니게 된다.
 */
export function chooseRoute(input: RouteInput): RouteDecision {
  if (input.transfer.allowed) {
    return { route: 'multimodal', reason: 'default_multimodal' }
  }
  if (input.hasLocalEngine) {
    return { route: 'ocr_engine', reason: 'external_blocked_by_doc_class' }
  }
  return { route: 'blocked', reason: 'no_local_engine' }
}

// ── 무엇을 읽을지 고르기 ─────────────────────────────────────

export type ImageTextReason =
  /** 이 쪽에 텍스트 레이어가 없다 */
  | 'no_text_layer'
  /** 문서 안에 박힌 그림 — 표를 그림으로 붙여 넣은 자리가 여기 걸린다 */
  | 'embedded_figure'

export type ImageTextTarget =
  | { kind: 'page'; pageNo: number }
  | { kind: 'figure'; figureId: string; blockId: string; pageNo: number | null }

export interface ImageTextPlanItem {
  target: ImageTextTarget
  reason: ImageTextReason
}

/**
 * 읽어야 할 자리만 고른다.
 *
 * `scanPages` 는 파서가 「글자가 없다」고 본 쪽이다. 여기서 한 번 더 재는 이유는,
 * 파서가 쪽을 잘못 셌을 때 **글자가 있는 쪽을 모델에 보내 원문을 덮는 일**을 막기 위해서다.
 */
export function planImageText(doc: IrDocument, scanPages: readonly number[]): ImageTextPlanItem[] {
  const charsByPage = new Map<number, number>()
  for (const b of doc.blocks) {
    if (b.pageNo === null) continue
    charsByPage.set(b.pageNo, (charsByPage.get(b.pageNo) ?? 0) + b.text.length)
  }

  const items: ImageTextPlanItem[] = []
  for (const pageNo of [...scanPages].sort((a, b) => a - b)) {
    // 글자가 이미 있으면 부르지 않는다 — 부르면 원문을 모델이 쓴 글로 덮는다
    if ((charsByPage.get(pageNo) ?? 0) >= MIN_CHARS_PER_TEXT_PAGE) continue
    items.push({ target: { kind: 'page', pageNo }, reason: 'no_text_layer' })
  }

  const scanned = new Set(scanPages)
  for (const f of doc.figures) {
    // 이미 글자를 뽑아 둔 그림은 다시 안 읽는다
    if (f.extractedText) continue
    const block = doc.blocks.find((b) => b.blockId === f.blockId)
    const pageNo = block?.pageNo ?? null
    // 그 쪽을 통째로 읽기로 했으면 그림만 따로 또 읽지 않는다
    if (pageNo !== null && scanned.has(pageNo)) continue
    items.push({
      target: { kind: 'figure', figureId: f.figureId, blockId: f.blockId, pageNo },
      reason: 'embedded_figure',
    })
  }
  return items
}

// ── 비용 ─────────────────────────────────────────────────────

export interface PageRate {
  krwPerPage: number
  secondsPerPage: number
}

/**
 * 요금이 DB(rfp_ai_settings)에 없을 때 쓰는 기본값.
 *
 * 값 자체가 진실은 아니다 — **인입 시점에 «얼마쯤 든다»를 보여 주는 것**이 목적이다.
 * 숫자를 안 보여 주면 사용자는 200쪽짜리를 올려 놓고 청구서를 보고 나서야 안다.
 */
export const DEFAULT_PAGE_RATE: Record<Exclude<ImageTextRoute, 'blocked'>, PageRate> = {
  multimodal: { krwPerPage: 12, secondsPerPage: 4 },
  ocr_engine: { krwPerPage: 3, secondsPerPage: 2 },
}

export interface CostEstimate {
  pages: number
  krw: number
  seconds: number
}

/** 인입 시점에 부른다. 화면은 여기 값에 ±30% 를 붙여 보여 준다 */
export function estimateImageTextCost(
  items: readonly ImageTextPlanItem[],
  route: ImageTextRoute,
  rate?: PageRate,
): CostEstimate {
  if (route === 'blocked' || items.length === 0) return { pages: 0, krw: 0, seconds: 0 }
  const r = rate ?? DEFAULT_PAGE_RATE[route]
  const pages = items.length
  return {
    pages,
    krw: Math.round(pages * r.krwPerPage),
    seconds: Math.round(pages * r.secondsPerPage),
  }
}

// ── 신뢰도 ───────────────────────────────────────────────────

/**
 * 이 아래면 근거로 쓸 때 경고가 붙는다.
 *
 * 기계가 읽은 글은 «비슷하게 생긴 글자»로 틀린다 — 5억을 6억으로 읽어도 문장은 멀쩡하다.
 * 그래서 낮은 신뢰도를 조용히 넘기지 않고 화면까지 들고 간다.
 */
export const IMAGE_TEXT_CONFIDENCE_WARN = 0.6

export function isLowConfidence(confidence: number | null): boolean {
  if (confidence === null) return true   // 모르면 낮은 것으로 본다
  return confidence < IMAGE_TEXT_CONFIDENCE_WARN
}

// ── 결과를 블록으로 ──────────────────────────────────────────

export interface ImageTextOutput {
  /** planImageText 가 돌려준 배열에서 몇 번째인가 */
  index: number
  text: string
  confidence: number | null
  /** 모델 이름 또는 엔진 이름. 빈 값이면 근거의 출처를 알 수 없다 */
  producedBy: string
}

export interface ImageTextResult {
  block: IrBlock
  producedBy: string
  confidence: number | null
  /** 근거로 쓸 때 경고를 띄워야 하나 */
  lowConfidence: boolean
  target: ImageTextTarget
}

/**
 * 모델·엔진이 돌려준 글을 IR 블록으로 만든다.
 *
 * 출처를 블록에 실어 두지 않으면, 나중에 리포트가 그 문장을 인용했을 때
 * 「원문에 그렇게 쓰여 있다」와 「기계가 그렇게 읽었다」를 구분할 수 없다.
 */
export function toImageTextBlocks(
  fileId: string,
  plan: readonly ImageTextPlanItem[],
  outputs: readonly ImageTextOutput[],
  startOrder: number,
): ImageTextResult[] {
  const results: ImageTextResult[] = []
  let order = startOrder

  for (const out of outputs) {
    const item = plan[out.index]
    if (!item) continue
    const text = out.text.trim()
    if (!text) continue
    if (!out.producedBy) throw new Error('출처 없는 이미지 텍스트는 근거로 쓸 수 없다')

    const pageIdx = item.target.kind === 'page'
      ? item.target.pageNo
      : (item.target.pageNo ?? 0)

    const block = makeBlock(fileId, order++, {
      type: item.target.kind === 'figure' ? 'figure' : 'paragraph',
      text,
      pageNo: item.target.kind === 'page' ? item.target.pageNo : item.target.pageNo,
      sourceRef: { kind: 'image', pageIdx, extractedBy: out.producedBy },
      ocrConfidence: out.confidence,
    })

    results.push({
      block,
      producedBy: out.producedBy,
      confidence: out.confidence,
      lowConfidence: isLowConfidence(out.confidence),
      target: item.target,
    })
  }
  return results
}

/**
 * 뽑은 글을 문서에 합친다 — 원본을 바꾸지 않고 새 문서를 돌려준다.
 *
 * 원본을 고치면 재처리했을 때 «이미 합쳐진 문서에 또 합치는» 일이 생기고,
 * 그때부터 같은 문장이 쪽마다 두 벌씩 쌓인다.
 */
export function mergeImageText(doc: IrDocument, results: readonly ImageTextResult[]): IrDocument {
  if (results.length === 0) return doc

  const figureText = new Map<string, string>()
  for (const r of results) {
    if (r.target.kind === 'figure') figureText.set(r.target.figureId, r.block.text)
  }

  const figures: IrFigure[] = doc.figures.map((f) =>
    figureText.has(f.figureId) ? { ...f, extractedText: figureText.get(f.figureId)! } : f)

  return {
    ...doc,
    blocks: [...doc.blocks, ...results.map((r) => r.block)],
    figures,
    meta: {
      ...doc.meta,
      warnings: results.some((r) => r.lowConfidence)
        ? Array.from(new Set([...doc.meta.warnings, IMAGE_TEXT_WARNING.lowConfidence]))
        : doc.meta.warnings,
    },
  }
}

export const IMAGE_TEXT_WARNING = {
  /** 기계가 읽은 글의 신뢰도가 낮다 */
  lowConfidence: 'image_text_low_confidence',
  /** 등급 때문에 어느 길로도 못 읽었다 */
  blocked: 'image_text_blocked',
} as const

/** 합친 결과의 평균 신뢰도 — 품질 점수를 다시 매길 때 넣는다 */
export function averageConfidence(results: readonly ImageTextResult[]): number | null {
  const cs = results.map((r) => r.confidence).filter((c): c is number => c !== null)
  if (cs.length === 0) return null
  return cs.reduce((a, b) => a + b, 0) / cs.length
}
