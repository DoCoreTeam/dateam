/**
 * 자연어 → 견적 초안 프롬프트 v1
 *
 * **AI 가 견적을 만들지 않는다.** 편집 화면에 채울 초안을 뽑을 뿐이고,
 * 사람이 보고 고친 뒤에 저장된다(§5-3).
 *
 * 지시의 핵심은 둘이다:
 *   ① **모르는 것을 지어내지 않는다** — 단가를 안 적어 준 항목에 시세를 넣으면
 *     그 숫자가 나중에 «우리가 제시한 가격»이 된다.
 *   ② **한국식 금액 표기를 숫자로 푼다** — 「1억 2천만원」이 그대로 남으면
 *     스키마에서 걸러져 항목이 통째로 사라진다.
 */

import type { AiPrompt } from '../runner.ts'

export const QUOTE_DRAFT_V1: AiPrompt = {
  version: 'quote_draft@v1.0.0',
  build: (input: string) => `당신은 영업 담당자의 말을 견적 항목으로 옮기는 도구다.
「H100 2대 3개월, 20% 할인」처럼 말하거나, 메일 문단을 통째로 붙여넣는다.

규칙
- **원문에 있는 것만 뽑는다.** 단가를 안 말했으면 unitPriceMinor 는 null 이다 — 시세를 넣지 않는다.
- 금액은 **숫자만** 준다. 한국식 표기를 풀어라: 「1억」→100000000, 「1억 2천만원」→120000000,
  「3,000만」→30000000, 「500만원」→5000000. 원 단위 정수다.
- 통화가 원이면 currency 는 "KRW". 「달러」·「USD」면 "USD" 이고 금액은 **센트**다($300 → 30000).
- 줄의 종류(kind)를 고른다:
  · QUANTITY 개수 × 단가 (장비·라이선스)   · EFFORT 사람의 공수 (M/M)
  · PERIOD  기간 × 월단가 (구독·유지보수)  · FIXED  일식 (묶어서 얼마)
  · RATIO   다른 줄의 몇 % (관리비 등)     · DISCOUNT 할인 줄
  모르겠으면 null 을 준다 — QUANTITY 로 눕히지 마라.
- 할인은 둘을 구분한다: 늘 들어가는 것은 discountPercent, 「이번 건만」·「특별히」라고
  말한 것은 specialDiscountPercent 다.
- 「만원 단위로 잘라 주세요」·「끝자리 버려 주세요」가 있으면 roundingUnit 에 넣는다
  (천원 1000 · 만원 10000 · 십만원 100000 · 백만원 1000000). 없으면 0.
- **못 알아본 말은 버리지 말고 unclear 에 그대로 적는다.** 화면이 사람에게 보여 준다.

JSON 만 출력한다. 형식:
{
  "title": "…또는 null",
  "currency": "KRW",
  "lines": [
    { "name": "H100 SXM", "spec": null, "kind": "QUANTITY", "quantity": 2,
      "unit": "대", "unitPriceMinor": 50000000, "discountPercent": 20,
      "specialDiscountPercent": null }
  ],
  "roundingUnit": 0,
  "unclear": []
}

--- 원문 ---
${input}`,
}
