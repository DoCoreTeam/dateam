/**
 * 5축 결과 → 제안 (SSOT)
 *
 * **왜 따로 뽑았나**: 이 매핑이 미팅 서비스 안에만 있었다. 그래서 활동 노트에서도
 * 같은 5축을 읽게 되자 두 벌이 될 참이었다 — 재사용·단일구현 정책이 금지하는 바로 그 형태다.
 * 한쪽만 고치면 "미팅에서는 금액을 제안하는데 노트에서는 안 한다" 같은 차이가 생기고,
 * 사용자는 그걸 버그가 아니라 **제품이 원래 그런 것**으로 배운다.
 *
 * 원본(미팅)의 규칙을 그대로 유지한다:
 *   · WHAT(금액)·WHERE(단계)는 **딜이 연결돼 있을 때만** — 어느 딜의 값인지 모르면 제안할 수 없다
 *   · WHO(사람)는 **회사가 연결돼 있을 때만** — 소속 없는 인물은 CRM 을 오염시킨다
 *   · RISK·NEXT 는 값이 아니라 읽을 거리다. 출처(미팅/활동)에 붙여 두고 사람이 정한다
 *   · 제안 하나가 실패해도 나머지는 보낸다 — 기록 하나가 통째로 헛되면 안 된다
 *
 * 달라진 것은 **어디에 붙느냐** 하나뿐이라 그것만 인자로 받는다.
 */

import { createSuggestion, type SuggestionAxis } from './suggestion.ts'
import type { FiveAxisOutput } from '../ai/schemas/five-axis.ts'

/**
 * 5축을 읽어낸 출처와 그 출처가 아는 연결.
 *
 * `anchorType` 은 RISK·NEXT 처럼 "값이 아닌 것"이 붙을 자리다.
 * 미팅이면 미팅에, 활동 노트면 그 활동에 붙는다 — 사람이 인박스에서
 * "이게 어디서 나온 말인지" 되짚을 수 있어야 하기 때문이다.
 */
export interface AxisAnchor {
  companyId: string | null
  dealId: string | null
  anchorType: 'meeting' | 'activity'
  anchorId: string
}

export async function fiveAxisToSuggestions(
  workspaceId: string,
  actorId: string | null,
  runId: string,
  anchor: AxisAnchor,
  out: FiveAxisOutput,
): Promise<number> {
  let n = 0

  const send = async (
    axis: SuggestionAxis,
    targetType: string, targetId: string | null,
    field: string | null, proposedValue: unknown,
    confidence: number, quote: string, segmentIds: string[],
  ) => {
    try {
      const r = await createSuggestion(workspaceId, actorId, {
        runId, axis, targetType, targetId, field,
        proposedValue, confidence,
        evidence: { quote, segmentIds },
      })
      if (r.suggestion) n += 1
    } catch (e) {
      // 제안 하나가 실패해도 나머지는 보낸다 — 기록 전체가 헛되면 안 된다
      console.error('[crm/five-axis] 제안 생성 실패:', axis, field, e)
    }
  }

  // WHAT — 금액. 딜이 연결돼 있을 때만(어느 딜의 금액인지 모르면 제안할 수 없다)
  if (anchor.dealId) {
    for (const w of out.what) {
      if (w.amountMinor === null) continue
      await send('WHAT', 'deal', anchor.dealId, 'amountMinor', String(w.amountMinor),
        w.confidence, w.evidence.quote, w.evidence.segmentIds)
    }
  }

  // WHERE — 다음 단계. 값이 아니라 이동이라 항상 사람이 본다(절대규칙 3)
  if (anchor.dealId && out.where?.suggestedStageName) {
    await send('WHERE', 'deal', anchor.dealId, 'stageId', out.where.suggestedStageName,
      out.where.confidence, out.where.evidence.quote, out.where.evidence.segmentIds)
  }

  // WHO — 사람. 회사가 연결돼 있을 때만 새 인물을 제안한다
  if (anchor.companyId) {
    for (const p of out.who) {
      await send('WHO', 'person', null, null,
        { name: p.name, title: p.title, email: p.email, role: p.role, companyId: anchor.companyId },
        p.confidence, p.evidence.quote, p.evidence.segmentIds)
    }
  }

  // RISK·NEXT — 값이 아니라 읽을 거리다. 출처에 붙여 두고 사람이 정한다
  for (const r of out.risk) {
    await send('RISK', anchor.anchorType, anchor.anchorId, null,
      { kind: r.kind, polarity: r.polarity, description: r.description },
      r.confidence, r.evidence.quote, r.evidence.segmentIds)
  }
  for (const t of out.next) {
    await send('NEXT', anchor.anchorType, anchor.anchorId, null,
      { title: t.title, dueDate: t.dueDate, assigneeHint: t.assigneeHint, emailDraftGist: t.emailDraftGist },
      t.confidence, t.evidence.quote, t.evidence.segmentIds)
  }

  return n
}
