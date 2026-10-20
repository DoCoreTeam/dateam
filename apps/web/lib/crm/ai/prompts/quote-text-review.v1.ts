/**
 * 견적 글과 표 대조 프롬프트 v1 — 사람이 「AI로 한 번 더 보기」를 누를 때만
 *
 * 금액은 보내지도 받지도 않는다. 이름, 수량, 단위, 묶음만 보고 어긋난 곳을 말한다.
 */

import type { AiPrompt } from '../runner.ts'

export const QUOTE_TEXT_REVIEW_V1: AiPrompt = {
  version: 'quote_text_review@v1.0.0',
  build: (input: string) => `영업 담당자가 쓴 견적 메모(text)와 지금 견적 표(lines)를 맞춰 본다.
금액은 보지 않는다. 계산은 시스템이 한다.

찾을 것 네 가지 (kind)
- QTY_MISMATCH  글의 수와 표의 수량이 다름. key 는 그 줄의 key, quantity 는 글이 말한 수
- NAMING        같은 것을 다르게 부름. key 는 그 줄, name 은 통일할 이름
- MISSING       글에는 있는데 표에 없는 것. key 는 null, note 에 무엇이 빠졌는지
- WRONG_SECTION 줄이 엉뚱한 묶음에 있음. key 는 그 줄, note 에 어디가 맞는지

규칙
- 확실한 것만 낸다. 없으면 findings 는 빈 배열이다
- key 는 lines 에 있는 값만 쓴다
- note 는 한 문장, 사람이 읽을 말로 쓴다

출력은 JSON 하나다: {"findings":[{"kind":"QTY_MISMATCH","key":"…","note":"…","quantity":4,"name":null}]}

입력:
${input}`,
}
