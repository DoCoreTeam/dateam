/**
 * 명함 이미지 → 텍스트 (기획 차수 0 · 사용자 지시 2026-08-28)
 *
 * **왜 «텍스트만» 뽑나**: 회사·인물을 만드는 일은 이미 `quickCreate` 가 한다 —
 * 중복 판정·트랜잭션·빈 칸(gap) 처리가 전부 거기 있다.
 * 여기서 레코드까지 만들면 **같은 규칙이 두 벌**이 되고, 언젠가 한쪽만 고쳐진다.
 * (사용자 지시: 「명함 이미지를 넣는게 있으면 한번에 다 등록 시킬 수 있는거자나?
 *  … 이미지는 n장도 넣을 수 있고 … 메일 하단 서명을 복붙해서 넣을 수도 있도록」
 *  — 셋 다 «텍스트가 되면 그 다음은 같다»가 답이다.)
 *
 * **한 장씩 읽는다.** 여러 장을 한 번에 넣으면 모델이 사람을 섞는다 —
 * A 회사 이름과 B 사람 이메일이 한 레코드로 나오는 사고가 이 종류의 고전이다.
 *
 * **읽은 글자를 그대로 돌려준다.** 우리가 해석하지 않는다 —
 * 해석은 `quickCreate` 의 몫이고, 원문이 남아야 사용자가 「명함에 이런 말이 있었는데」를 확인한다.
 */

import { CrmError } from '../domain/errors.ts'

/** 명함 한 장은 작다. 이보다 크면 사진을 줄여 달라고 말하는 것이 맞다 */
export const CARD_MAX_BYTES = 8 * 1024 * 1024

export const CARD_MIME_OK: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/heic']

/** 한 번에 받는 장수 — 모델을 그만큼 부르므로 상한이 필요하다 */
export const CARD_MAX_COUNT = 10

const PROMPT = `이 이미지는 명함이다. **적혀 있는 글자를 그대로** 옮겨 적어라.

규칙:
- 줄 구조를 지킨다. 회사명 / 이름 직함 / 부서 / 연락처가 각각 다른 줄이면 그대로 나눈다.
- 해석하거나 보충하지 않는다. 없는 정보를 지어내지 않는다.
- 로고 안의 회사명도 글자면 적는다.
- 뒷면(영문)이 함께 보이면 그것도 적는다.
- 판독이 불확실한 글자는 그 자리에 ? 를 넣는다. 지우지 않는다.
- 설명·머리말 없이 **옮겨 적은 글자만** 출력한다.`

export interface CardReadResult {
  /** 명함에서 읽은 글자 — 이 값이 그대로 quickCreate 의 입력이 된다 */
  text: string
  fileName: string
}

export function assertCardFile(size: number, mime: string, name: string): void {
  if (size > CARD_MAX_BYTES) {
    throw new CrmError('VALIDATION_FAILED',
      `${name} 은(는) 너무 큽니다. 8MB 이하로 줄여 주세요.`, { field: 'file' })
  }
  if (!CARD_MIME_OK.includes(mime)) {
    throw new CrmError('VALIDATION_FAILED',
      `${name} 은(는) 이미지가 아닙니다. PNG·JPG·WebP 만 읽을 수 있어요.`, { field: 'file' })
  }
}

/**
 * 명함 한 장을 읽는다.
 *
 * **키는 호스트 것을 쓴다**(재사용·단일구현 정책) — CRM 이 키를 따로 갖지 않는다.
 * 모델도 호스트의 폴백 사슬(`resolveGeminiModelChain`)을 그대로 쓴다:
 * 한 모델이 한도에 걸려도 다음 것으로 넘어간다.
 */
export async function readBusinessCard(
  base64: string, mimeType: string, fileName: string,
  deps: { apiKey: string; models: readonly string[] },
): Promise<CardReadResult> {
  let lastError = ''
  for (const model of deps.models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': deps.apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: base64 } }, { text: PROMPT }] }],
            // 명함은 창작이 아니다 — 온도를 0 에 가깝게 둬 읽은 대로만 나오게 한다
            generationConfig: { temperature: 0.05 },
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(45_000),
        },
      )
      if (!res.ok) {
        lastError = `${res.status}`
        // 한도(429)·모델 없음(404)이면 다음 모델로. 그 밖은 즉시 실패로 말한다
        if (res.status === 429 || res.status === 404) continue
        throw new CrmError('CONFLICT', `명함을 읽지 못했습니다 (${res.status}).`)
      }
      const json = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
      if (!text) { lastError = 'empty'; continue }
      return { text, fileName }
    } catch (e) {
      if (e instanceof CrmError) throw e
      lastError = e instanceof Error ? e.message : 'unknown'
    }
  }
  throw new CrmError('CONFLICT',
    `${fileName} 에서 글자를 읽지 못했습니다. 사진이 흐리면 다시 찍어 주세요. (${lastError})`)
}
