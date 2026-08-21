/**
 * 이미 있는 레코드에 새로 나온 정보를 **제안으로** 넘긴다 (dacrm 정정판)
 *
 * **왜 이 파일이 생겼나**: 붙여넣기 등록이 이미 있는 회사·인물을 찾으면
 * 연결만 하고 **새로 읽어낸 정보는 그냥 버렸다.** 명함에 적힌 새 전화번호,
 * 바뀐 직함, 처음 나온 도메인이 전부 사라졌다.
 *
 * 그렇다고 조용히 덮어쓸 수는 없다. 절대규칙 1 — **AI 출력은 코어 테이블에 직접 쓰지 않는다.**
 * 사람이 직접 적어 둔 값을 AI 가 말없이 바꾸면, 사용자는 자기가 적은 것이
 * 언제 왜 바뀌었는지 영영 모른다.
 *
 * 그래서 **제안으로 보낸다.** 인박스에서 사람이 보고 수락하면 그때 반영된다.
 * 이게 인박스가 실제로 채워지는 첫 경로다 — 그전까지 인박스는
 * 제안을 만드는 코드가 하나도 없어 **구조적으로 영원히 빈 화면**이었다.
 *
 * 규칙 셋:
 *   ① **빈 칸일 때만 제안한다.** 이미 값이 있으면 새 정보가 맞는지 우리가 알 수 없다.
 *      "전화번호가 둘 다 맞을" 수 있어서, 덮는 제안은 사람을 헷갈리게만 한다.
 *   ② **같은 값이면 제안하지 않는다.** 아무것도 안 바뀌는 제안이 인박스에 쌓이면
 *      사람은 인박스를 안 보게 된다.
 *   ③ **근거를 함께 보낸다.** 원문의 어느 대목에서 읽었는지 없으면
 *      사람이 수락 여부를 판단할 수 없다.
 */

import { createSuggestion } from './suggestion.ts'
import type { SuggestionAxis } from './suggestion.ts'

/** 어떤 필드를 어느 축으로 제안할지 — 축이 없으면 인박스가 묶어서 보여 줄 수 없다 */
const FIELD_AXIS: Record<string, SuggestionAxis> = {
  // 회사
  domain: 'WHO', industry: 'WHAT', region: 'WHERE',
  // 회사 — 웹 보강이 채우는 나머지(enrich-web.ts). 축이 없으면 인박스가 묶어서 못 보여 준다
  employeeRange: 'WHAT', descriptionMd: 'WHAT',
  // 인물
  email: 'WHO', phone: 'WHO', title: 'WHO',
}

/**
 * 붙여넣기 경로가 쓰던 기본 신뢰도.
 *
 * 원문에서 그대로 읽어낸 값이라 확신이 높다. 다만 1.0 은 쓰지 않는다 —
 * 사람이 검토할 여지를 남기는 게 이 관문의 목적이다.
 */
const DEFAULT_CONFIDENCE = 0.8

export interface EnrichOptions {
  /**
   * 이 제안들의 신뢰도.
   *
   * **왜 인자로 받나**: 근거의 강도가 경로마다 다르다. 명함에 적힌 전화번호와
   * 이름만으로 웹에서 찾은 회사는 확신이 같을 수 없다. 하나로 고정해 두면
   * 둘 중 하나는 반드시 틀린 값이 되고, 그 값이 자동 반영 문턱(0.85)을 좌우한다.
   */
  confidence?: number
  /**
   * 근거에 함께 남길 것.
   *
   * 붙여넣기는 **원문 인용**이 근거였다. 웹 보강은 인용할 원문이 없고
   * 대신 **출처 URL** 이 근거다 — 화면이 그걸 보여 줘야 사람이 수락을 판단한다.
   */
  evidence?: Record<string, unknown>
}

export interface EnrichCandidate {
  targetType: 'company' | 'person'
  targetId: string
  /** 지금 저장돼 있는 값 */
  current: Record<string, unknown>
  /** AI 가 원문에서 읽어낸 값 */
  proposed: Record<string, unknown>
}

export interface EnrichResult {
  /** 인박스로 보낸 제안 수 — 화면이 "N건을 인박스에 넣었어요"라고 말할 수 있어야 한다 */
  suggested: number
  /** 자동 반영된 수(필드 설정이 허용한 경우) */
  applied: number
}

/**
 * 후보들을 훑어 빈 칸만 제안으로 만든다.
 *
 * 실패해도 **등록 자체를 막지 않는다.** 제안은 곁들이는 일이고,
 * 그것 때문에 사용자가 방금 붙여넣은 명함이 통째로 사라지면 안 된다(감사·로깅이 쓰기를 막지 않는다는 원칙과 같다).
 */
export async function enrichFromText(
  workspaceId: string,
  actorId: string | null,
  runId: string,
  quote: string,
  candidates: EnrichCandidate[],
  opts: EnrichOptions = {},
): Promise<EnrichResult> {
  let suggested = 0
  let applied = 0
  const confidence = opts.confidence ?? DEFAULT_CONFIDENCE

  for (const c of candidates) {
    for (const [field, raw] of Object.entries(c.proposed)) {
      const axis = FIELD_AXIS[field]
      if (!axis) continue

      const value = typeof raw === 'string' ? raw.trim() : raw
      if (value === null || value === undefined || value === '') continue

      // ① 빈 칸일 때만 — 이미 적힌 값을 AI 가 바꾸자고 하면 사람이 판단하기 어렵다
      const cur = c.current[field]
      if (cur !== null && cur !== undefined && cur !== '') continue

      // ② 같은 값이면 보내지 않는다
      if (cur === value) continue

      try {
        const res = await createSuggestion(workspaceId, actorId, {
          runId,
          axis,
          targetType: c.targetType,
          targetId: c.targetId,
          field,
          currentValue: cur ?? null,
          proposedValue: value,
          confidence,
          evidence: { quote: quote.slice(0, 500), ...(opts.evidence ?? {}) },
        })
        if (res.suggestion) suggested += 1
        if (res.verdict.decision === 'AUTO_APPLIED') applied += 1
      } catch (e) {
        // 제안 하나가 실패했다고 나머지·본 등록까지 죽이지 않는다
        console.error('[crm/enrich] 제안 생성 실패:', field, e)
      }
    }
  }

  return { suggested, applied }
}
