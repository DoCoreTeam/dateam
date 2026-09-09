/**
 * 모델이 뱉은 글을 리포트 값으로 옮긴다
 *
 * ## 왜 별도 파일인가
 *
 * 여기가 **환각이 들어오는 유일한 문**이다. 값과 근거를 어떻게 받아들이는지가
 * 리포트의 신뢰도 전부를 정한다. 라우트 안에 인라인으로 두면 이 판정을
 * 실행해서 확인할 방법이 없다.
 *
 * ## 규칙 셋
 *
 * ① **근거 없는 값은 미확인이다.** 기본을 확인으로 두면 전부 확인으로 보인다.
 * ② 인용이 짧으면 근거로 안 친다 — 「사업 기간」 같은 다섯 글자는 어느 문서에나 있다.
 * ③ 모르는 칸은 버린다. 모델이 지어낸 필드 이름을 리포트 칸으로 만들면
 *    화면이 그 칸을 못 그리고, 그 값은 아무도 안 본 채 저장된다.
 */

import { recoverJson, asJsonRecord } from '../../ai/json-recover.ts'
import { emptyValue, MIN_QUOTE_CHARS, type Evidence, type ValueNode } from '../report/schema.ts'
import type { ExtractTask } from '../report/tasks.ts'

/** 근거 하나를 받아들인다 — 모양이 안 맞으면 버린다(억지로 채우지 않는다) */
export function toEvidence(raw: unknown, fileIdByBlock: Map<string, string>): Evidence | null {
  const r = asJsonRecord(raw)
  const blockId = str(r.blockId) ?? str(r.block_id)
  const quote = str(r.quote)
  if (!blockId || !quote) return null
  // 짧은 인용은 대조가 의미 없다. 통과시키면 근거가 있는 것처럼 보이기만 한다
  if (quote.length < MIN_QUOTE_CHARS) return null
  return {
    documentFileId: fileIdByBlock.get(blockId) ?? '',
    blockId,
    pageNo: num(r.pageNo ?? r.page_no),
    quote,
  }
}

export interface ParseFieldsInput {
  text: string
  task: ExtractTask
  vendor: string
  /** blockId → 어느 파일에서 나왔나 */
  fileIdByBlock: Map<string, string>
}

/**
 * 태스크가 요구한 칸만 골라 값 노드로 만든다.
 *
 * JSON 이 아예 안 나오면 빈 것을 돌려준다 — 던지면 그 태스크 하나 때문에
 * 리포트 전체가 실패한다(다른 여덟 칸은 멀쩡한데도).
 */
export function parseFields(input: ParseFieldsInput): Record<string, ValueNode<unknown>> {
  let parsed: unknown
  try {
    parsed = recoverJson(input.text)
  } catch {
    return {}
  }

  const body = asJsonRecord(parsed)
  const out: Record<string, ValueNode<unknown>> = {}

  for (const field of input.task.fields) {
    const raw = body[field]
    if (raw === undefined) continue

    // { value, evidence, confidence } 모양이면 그대로, 아니면 값만 온 것으로 본다
    const cell = isCell(raw) ? asJsonRecord(raw) : { value: raw }
    const evidence = list(cell.evidence)
      .map((e) => toEvidence(e, input.fileIdByBlock))
      .filter((e): e is Evidence => e !== null)

    const value = cell.value === undefined ? null : cell.value
    if (value === null && evidence.length === 0) continue

    out[field] = {
      ...emptyValue(),
      value,
      evidence,
      confidence: clamp01(num(cell.confidence)),
      // 근거가 있어야 확인이다 — 대조는 groundValue 가 한 번 더 한다
      grounding: evidence.length > 0 ? 'confirmed' : 'unconfirmed',
      vendor: input.vendor,
      verification: 'single',
    }
  }

  return out
}

/** 값 하나가 「값+근거」 모양인가 */
function isCell(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const r = raw as Record<string, unknown>
  return 'value' in r || 'evidence' in r
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}
function clamp01(v: number | null): number | null {
  if (v === null) return null
  return Math.min(1, Math.max(0, v))
}
function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/**
 * 모델에게 시킬 출력 모양.
 *
 * 예시를 안 주면 모델마다 다른 모양으로 답하고, 그러면 파싱이 벤더별로 갈린다.
 */
export function outputSpec(task: ExtractTask): string {
  return [
    '',
    '아래 JSON 하나만 답한다. 다른 말을 덧붙이지 않는다.',
    '{',
    ...task.fields.map((f) => `  "${f}": { "value": null, "confidence": 0.0, "evidence": [{ "blockId": "", "quote": "", "pageNo": null }] },`),
    '}',
    '',
    `quote 는 원문 그대로 ${MIN_QUOTE_CHARS}자 이상이라야 근거로 인정된다.`,
    '원문에서 못 찾은 값은 value 를 null 로 두고 evidence 를 비운다.',
  ].join('\n')
}
