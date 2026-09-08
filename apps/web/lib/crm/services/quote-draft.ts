/**
 * 자연어 → 견적 초안
 *
 * **레코드를 만들지 않는다.** 편집 화면(QuoteEditorModal)이 그대로 쓸 수 있는 «초안»만
 * 돌려주고, 사람이 보고 고친 뒤에 저장한다(§5-3 추출/제안형 — 자동 등록 금지).
 *
 * 왜 그래야 하나: 견적은 **고객에게 나가는 문서**다. AI 가 단가를 하나 잘못 풀면
 * 그 숫자가 그대로 제안가가 되고, 그걸 되돌릴 방법은 「죄송합니다」뿐이다.
 */

import { getCrmDb } from '../db/client.ts'
import { CrmError } from '../domain/errors.ts'
import { runAi } from '../ai/runner.ts'
import { QUOTE_DRAFT_V1 } from '../ai/prompts/quote-draft.v1.ts'
import { parseQuoteDraft, type QuoteDraftOutput } from '../ai/schemas/quote-draft.ts'
import { adapterFromSetting } from './quick-create.ts'
import type { AiAdapter } from '../ai/runner.ts'

const MAX_TEXT = 4000
/** 지금 견적을 몇 줄까지 AI 에게 보여 줄까 — 프롬프트가 원문보다 길어지면 안 된다 */
const MAX_CONTEXT_LINES = 30

/** 화면이 편집 중인 항목 — 「맞춰서」·「빼고」가 가리키는 대상 */
export interface CurrentLineContext {
  name: string
  quantity: string
  unit?: string
  unitPriceMinor: string
  discountPercent?: string
  taxRate?: string
}

/**
 * 지금 견적을 **읽을 수 있는 한 덩어리**로 만든다.
 *
 * 왜 필요한가: 「총액 3억에 맞춰서」는 맞출 대상이 있어야 성립하는 말인데,
 * 예전엔 텍스트만 보내서 AI 입장에선 맞출 것이 없었다. 그래서 그 말이
 * 통째로 «못 알아봤어요»로 돌아왔다(사용자 지적 2026-09-08).
 */
export function describeCurrentLines(lines: readonly CurrentLineContext[]): string {
  const use = lines.filter((l) => l.name?.trim()).slice(0, MAX_CONTEXT_LINES)
  if (use.length === 0) return ''
  const rows = use.map((l, i) => {
    const parts = [`${i + 1}. ${l.name.trim()}`, `수량 ${l.quantity || '?'}${l.unit ?? ''}`,
      `단가 ${l.unitPriceMinor || '0'}원`]
    if (l.discountPercent && l.discountPercent !== '0') parts.push(`할인 ${l.discountPercent}%`)
    if (l.taxRate) parts.push(`부가세 ${l.taxRate}%`)
    return parts.join(' · ')
  })
  return `--- 지금 견적 ---\n${rows.join('\n')}\n`
}

export interface QuoteDraftResult {
  /** 화면이 그대로 초안에 얹는 값 */
  draft: QuoteDraftOutput
  /** 무엇으로 만들었는지 — 사람이 원문과 대조할 수 있어야 한다 */
  text: string
  runId: string
}

export async function draftQuoteFromText(
  workspaceId: string,
  text: string,
  adapter?: AiAdapter,
  /** 화면이 편집 중인 항목 — 있으면 프롬프트 앞에 붙여 「맞춰서」를 이해하게 한다 */
  currentLines?: readonly CurrentLineContext[],
): Promise<QuoteDraftResult> {
  const input = typeof text === 'string' ? text.trim() : ''
  if (!input) {
    throw new CrmError('VALIDATION_FAILED', '견적으로 만들 내용을 입력해 주세요.', { field: 'text' })
  }
  if (input.length > MAX_TEXT) {
    throw new CrmError('VALIDATION_FAILED',
      `내용이 너무 깁니다. ${MAX_TEXT.toLocaleString('ko-KR')}자 이내로 줄여 주세요.`, { field: 'text' })
  }

  const db = getCrmDb(workspaceId)
  const chosen = adapter ?? await adapterFromSetting(db)
  const { output, runId } = await runAi<QuoteDraftOutput>({
    db, workspaceId, kind: 'QUICK_CREATE',
    prompt: QUOTE_DRAFT_V1,
    /*
      지금 견적을 **원문 앞에** 붙인다. 뒤에 붙이면 모델이 그것을 «새로 만들 항목»으로 읽는다 —
      앞에 두고 «지금 견적»이라고 이름을 달아야 «참고할 것»이 된다.
    */
    input: currentLines?.length ? `${describeCurrentLines(currentLines)}\n--- 요청 ---\n${input}` : input,
    inputRef: { chars: input.length },
    parse: parseQuoteDraft,
    adapter: chosen,
  })

  return { draft: output, text: input, runId }
}
