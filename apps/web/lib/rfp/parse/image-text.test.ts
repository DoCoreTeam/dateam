/**
 * 이미지 텍스트화 가드 (설계서 3.3.2)
 *
 * 여기서 잠그는 것 넷
 * - 글자가 이미 있는 쪽은 모델을 안 부르는가 (부르면 원문을 모델이 쓴 글로 덮는다)
 * - 기본이 멀티모달이고 별도 엔진은 폴백인가 (사용자가 지적한 자리다)
 * - 결과에 출처와 신뢰도가 실리는가
 * - 인입 시점에 비용이 나오는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  chooseRoute, planImageText, estimateImageTextCost, toImageTextBlocks, mergeImageText,
  isLowConfidence, averageConfidence,
  IMAGE_TEXT_CONFIDENCE_WARN, DEFAULT_PAGE_RATE, IMAGE_TEXT_WARNING,
  type ImageTextPlanItem, type ImageTextOutput,
} from './image-text.ts'
import { makeBlock, makeDocument } from '../ir/build.ts'
import type { IrDocument, IrMeta } from '../ir/types.ts'
import { MIN_CHARS_PER_TEXT_PAGE } from './office.ts'

const META: IrMeta = {
  fileRole: 'rfp_main', format: 'pdf', pageCount: 3,
  parser: 'officeparser', parserVersion: '7.3.0', qualityScore: 40, warnings: [],
}

function 문서(opts: {
  pages?: { pageNo: number; chars: number }[]
  figures?: { figureId: string; pageNo: number | null; extracted?: string }[]
} = {}): IrDocument {
  const blocks = []
  let order = 0
  for (const p of opts.pages ?? []) {
    blocks.push(makeBlock('f1', order++, {
      type: 'paragraph', text: '가'.repeat(p.chars), pageNo: p.pageNo,
      sourceRef: { kind: 'pdf', pageIdx: p.pageNo, charStart: 0, charEnd: p.chars },
    }))
  }
  const figures = (opts.figures ?? []).map((f) => {
    const b = makeBlock('f1', order++, {
      type: 'figure', text: '', pageNo: f.pageNo,
      sourceRef: { kind: 'office', nodePath: `/fig/${f.figureId}` },
    })
    blocks.push(b)
    return { figureId: f.figureId, blockId: b.blockId, imageRef: null, extractedText: f.extracted ?? null }
  })
  return makeDocument({ meta: META, blocks, figures })
}

const 허용 = { allowed: true as const, internal: false }
const 차단 = { allowed: false as const, reason: 'admin_approval_required' as const }

// ── 경로 ─────────────────────────────────────────────────────

test('기본 경로는 멀티모달 모델이다', () => {
  const d = chooseRoute({ docClass: 'public', transfer: 허용, hasLocalEngine: true })
  // 폴백을 기본으로 올리면 공개 문서까지 성능이 낮은 길로 다닌다
  assert.equal(d.route, 'multimodal')
  assert.equal(d.reason, 'default_multimodal')
})

test('사내 엔진이 있어도 보낼 수 있으면 멀티모달로 간다', () => {
  assert.equal(chooseRoute({ docClass: 'restricted', transfer: 허용, hasLocalEngine: true }).route, 'multimodal')
})

test('별도 엔진은 등급이 외부 전송을 막을 때만 쓴다', () => {
  const d = chooseRoute({ docClass: 'nda', transfer: 차단, hasLocalEngine: true })
  assert.equal(d.route, 'ocr_engine')
  assert.equal(d.reason, 'external_blocked_by_doc_class')
})

test('막혔는데 사내 엔진도 없으면 사람에게 넘긴다', () => {
  const d = chooseRoute({ docClass: 'nda', transfer: 차단, hasLocalEngine: false })
  // 조용히 빈 결과를 돌려주면 리포트가 「해당 내용 없음」이라 적는다
  assert.equal(d.route, 'blocked')
  assert.equal(d.reason, 'no_local_engine')
})

// ── 대상 고르기 ──────────────────────────────────────────────

test('글자가 없는 쪽만 대상이 된다', () => {
  const doc = 문서({ pages: [{ pageNo: 1, chars: 800 }, { pageNo: 2, chars: 0 }] })
  const plan = planImageText(doc, [2])
  assert.equal(plan.length, 1)
  assert.deepEqual(plan[0].target, { kind: 'page', pageNo: 2 })
  assert.equal(plan[0].reason, 'no_text_layer')
})

test('글자가 있는 쪽은 스캔 목록에 있어도 부르지 않는다', () => {
  const doc = 문서({ pages: [{ pageNo: 1, chars: 800 }] })
  // 파서가 쪽을 잘못 세도 원문을 덮지 않아야 한다
  assert.deepEqual(planImageText(doc, [1]), [])
})

test('경계 글자 수에서 정확하다', () => {
  const 딱맞음 = 문서({ pages: [{ pageNo: 1, chars: MIN_CHARS_PER_TEXT_PAGE }] })
  assert.deepEqual(planImageText(딱맞음, [1]), [])
  const 하나모자람 = 문서({ pages: [{ pageNo: 1, chars: MIN_CHARS_PER_TEXT_PAGE - 1 }] })
  assert.equal(planImageText(하나모자람, [1]).length, 1)
})

test('문서 안에 박힌 그림도 대상이 된다', () => {
  const doc = 문서({
    pages: [{ pageNo: 1, chars: 800 }],
    figures: [{ figureId: 'g1', pageNo: 1 }],
  })
  const plan = planImageText(doc, [])
  assert.equal(plan.length, 1)
  assert.equal(plan[0].reason, 'embedded_figure')
  assert.equal(plan[0].target.kind === 'figure' && plan[0].target.figureId, 'g1')
})

test('이미 글자를 뽑아 둔 그림은 다시 안 읽는다', () => {
  const doc = 문서({ figures: [{ figureId: 'g1', pageNo: 1, extracted: '항목 금액' }] })
  assert.deepEqual(planImageText(doc, []), [])
})

test('쪽을 통째로 읽기로 했으면 그 쪽 그림은 따로 안 읽는다', () => {
  const doc = 문서({ pages: [{ pageNo: 2, chars: 0 }], figures: [{ figureId: 'g1', pageNo: 2 }] })
  const plan = planImageText(doc, [2])
  // 같은 그림을 두 번 읽으면 비용이 두 배고 같은 문장이 두 벌 쌓인다
  assert.equal(plan.length, 1)
  assert.equal(plan[0].target.kind, 'page')
})

// ── 비용 ─────────────────────────────────────────────────────

test('인입 시점에 쪽 수와 비용과 시간이 나온다', () => {
  const plan: ImageTextPlanItem[] = [
    { target: { kind: 'page', pageNo: 1 }, reason: 'no_text_layer' },
    { target: { kind: 'page', pageNo: 2 }, reason: 'no_text_layer' },
  ]
  const est = estimateImageTextCost(plan, 'multimodal')
  // 숫자를 안 보여 주면 200쪽짜리를 올려 놓고 청구서를 보고 나서야 안다
  assert.equal(est.pages, 2)
  assert.equal(est.krw, 2 * DEFAULT_PAGE_RATE.multimodal.krwPerPage)
  assert.equal(est.seconds, 2 * DEFAULT_PAGE_RATE.multimodal.secondsPerPage)
})

test('사내 엔진이 멀티모달보다 싸다', () => {
  const plan: ImageTextPlanItem[] = [{ target: { kind: 'page', pageNo: 1 }, reason: 'no_text_layer' }]
  assert.ok(estimateImageTextCost(plan, 'ocr_engine').krw < estimateImageTextCost(plan, 'multimodal').krw)
})

test('막힌 경로와 빈 계획은 0원이다', () => {
  assert.deepEqual(estimateImageTextCost([], 'multimodal'), { pages: 0, krw: 0, seconds: 0 })
  assert.deepEqual(
    estimateImageTextCost([{ target: { kind: 'page', pageNo: 1 }, reason: 'no_text_layer' }], 'blocked'),
    { pages: 0, krw: 0, seconds: 0 },
  )
})

test('DB 에 요금이 있으면 그것을 쓴다', () => {
  const plan: ImageTextPlanItem[] = [{ target: { kind: 'page', pageNo: 1 }, reason: 'no_text_layer' }]
  // 설정값은 코드가 아니라 DB 에서 온다
  assert.equal(estimateImageTextCost(plan, 'multimodal', { krwPerPage: 40, secondsPerPage: 9 }).krw, 40)
})

// ── 결과 블록 ────────────────────────────────────────────────

const 계획: ImageTextPlanItem[] = [
  { target: { kind: 'page', pageNo: 2 }, reason: 'no_text_layer' },
  { target: { kind: 'figure', figureId: 'g1', blockId: 'b-g1', pageNo: 1 }, reason: 'embedded_figure' },
]

test('결과 블록에 출처와 신뢰도가 실린다', () => {
  const outs: ImageTextOutput[] = [
    { index: 0, text: '사업금액 500,000,000원', confidence: 0.92, producedBy: 'gemini-2.5-flash' },
  ]
  const [r] = toImageTextBlocks('f1', 계획, outs, 10)

  assert.equal(r.producedBy, 'gemini-2.5-flash')
  assert.equal(r.confidence, 0.92)
  assert.equal(r.lowConfidence, false)
  assert.equal(r.block.ocrConfidence, 0.92)
  // 근거 화면이 「원문에 쓰여 있다」와 「기계가 읽었다」를 구분해야 한다
  assert.equal(r.block.sourceRef.kind, 'image')
  assert.equal(r.block.sourceRef.kind === 'image' && r.block.sourceRef.extractedBy, 'gemini-2.5-flash')
  assert.equal(r.block.pageNo, 2)
  assert.equal(r.block.orderNo, 10)
})

test('출처 없는 결과는 받지 않는다', () => {
  // 출처를 모르면 그 문장이 왜 거기 있는지 영영 설명할 수 없다
  assert.throws(
    () => toImageTextBlocks('f1', 계획, [{ index: 0, text: 'ㄱ', confidence: 1, producedBy: '' }], 0),
    /출처 없는/,
  )
})

test('신뢰도가 낮으면 경고 플래그가 선다', () => {
  const 낮음: ImageTextOutput[] = [
    { index: 0, text: '사업금액 5억원', confidence: IMAGE_TEXT_CONFIDENCE_WARN - 0.01, producedBy: 'engine-a' },
  ]
  const [r] = toImageTextBlocks('f1', 계획, 낮음, 0)
  // 5억을 6억으로 읽어도 문장은 멀쩡하다. 그래서 조용히 넘기지 않는다
  assert.equal(r.lowConfidence, true)
})

test('신뢰도를 모르면 낮은 것으로 본다', () => {
  assert.equal(isLowConfidence(null), true)
  assert.equal(isLowConfidence(IMAGE_TEXT_CONFIDENCE_WARN), false)
  assert.equal(isLowConfidence(IMAGE_TEXT_CONFIDENCE_WARN - 0.001), true)
})

test('빈 글과 없는 계획 번호는 블록이 되지 않는다', () => {
  const outs: ImageTextOutput[] = [
    { index: 0, text: '   ', confidence: 1, producedBy: 'm' },
    { index: 99, text: '있는 글', confidence: 1, producedBy: 'm' },
  ]
  assert.deepEqual(toImageTextBlocks('f1', 계획, outs, 0), [])
})

// ── 합치기 ───────────────────────────────────────────────────

test('합치면 원본을 바꾸지 않고 새 문서가 나온다', () => {
  const doc = 문서({ pages: [{ pageNo: 1, chars: 800 }] })
  const before = doc.blocks.length
  const results = toImageTextBlocks('f1', 계획, [
    { index: 0, text: '스캔 쪽 글', confidence: 0.9, producedBy: 'm1' },
  ], before)

  const merged = mergeImageText(doc, results)
  // 원본을 고치면 재처리 때 같은 문장이 두 벌씩 쌓인다
  assert.equal(doc.blocks.length, before)
  assert.equal(merged.blocks.length, before + 1)
})

test('그림에서 뽑은 글은 그림 칸에도 들어간다', () => {
  const doc = 문서({ figures: [{ figureId: 'g1', pageNo: 1 }] })
  const plan = planImageText(doc, [])
  const results = toImageTextBlocks('f1', plan, [
    { index: 0, text: '항목\t금액', confidence: 0.8, producedBy: 'm1' },
  ], 0)
  const merged = mergeImageText(doc, results)
  assert.equal(merged.figures[0].extractedText, '항목\t금액')
  assert.equal(doc.figures[0].extractedText, null, '원본 그림을 고쳤다')
})

test('신뢰도 낮은 결과가 하나라도 있으면 문서에 경고가 남는다', () => {
  const doc = 문서({ pages: [{ pageNo: 1, chars: 800 }] })
  const results = toImageTextBlocks('f1', 계획, [
    { index: 0, text: '흐릿한 글', confidence: 0.3, producedBy: 'm1' },
  ], 1)
  assert.ok(mergeImageText(doc, results).meta.warnings.includes(IMAGE_TEXT_WARNING.lowConfidence))
})

test('합칠 것이 없으면 같은 문서를 그대로 돌려준다', () => {
  const doc = 문서({ pages: [{ pageNo: 1, chars: 800 }] })
  assert.equal(mergeImageText(doc, []), doc)
})

test('평균 신뢰도는 값이 있는 것만 센다', () => {
  const results = toImageTextBlocks('f1', 계획, [
    { index: 0, text: 'ㄱ', confidence: 0.8, producedBy: 'm' },
    { index: 1, text: 'ㄴ', confidence: null, producedBy: 'm' },
  ], 0)
  assert.equal(averageConfidence(results), 0.8)
  assert.equal(averageConfidence([]), null)
})
