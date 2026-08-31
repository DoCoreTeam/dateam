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
    prompt: QUOTE_DRAFT_V1, input,
    inputRef: { chars: input.length },
    parse: parseQuoteDraft,
    adapter: chosen,
  })

  return { draft: output, text: input, runId }
}
