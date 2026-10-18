/**
 * 계약서 원문 → 칸 자리 짚기 프롬프트 v1 (P0132 I07)
 *
 * ## 이 프롬프트는 글을 쓰지 않는다
 *
 * 조항은 코드가 이미 나눴다. 모델이 하는 일은 원문에 **그대로 있는 글자** 가운데
 * 계약마다 바뀌는 값(상호, 대표자, 금액, 날짜)을 찾아 칸 이름과 짝짓는 것뿐이다.
 * 바꾸기는 코드가 하고, 원문에 없는 글자를 내면 코드가 버린다(services/contract-from-file.ts).
 *
 * 칸 이름 목록은 `CONTRACT_FIELDS` 에서 만든다 — 여기 따로 적으면 칸이 늘 때 이 글이 늙는다.
 */

import type { AiPrompt } from '../runner.ts'
import { CONTRACT_FIELDS } from '../../domain/contract-fields.ts'

const FIELD_LIST = CONTRACT_FIELDS.filter((f) => f.kind !== 'block').map((f) => `- ${f.label}`).join('\n')

export const CONTRACT_TEMPLATE_FROM_DOC_V1: AiPrompt = {
  version: 'contract_template_from_doc@v1.0.0',
  build: (input: string) => `당신은 계약서 원문에서 **계약마다 바뀌는 값의 자리**를 짚는 도구다.
원문은 이미 조항으로 나뉘어 「[조항 N] 제목」 아래에 있다.

할 일
- 원문에서 이 계약에만 해당하는 값(회사 이름, 대표자, 사업자번호, 주소, 금액, 날짜, 계약 번호)을 찾는다
- 그 글자를 **원문에 적힌 그대로** text 에 옮기고, 아래 칸 이름 중 맞는 것을 field 에 적는다
- 그 글자가 있는 조항 번호를 clause 에 적는다

하지 말 것
- 글을 고치거나 요약하지 마라. 띄어쓰기 하나도 바꾸지 마라
- 원문에 없는 글자를 text 에 적지 마라
- 「갑」 「을」 「본 계약」 같은 계약서 일반 말은 칸이 아니다
- 맞는 칸 이름이 없으면 그 값은 건너뛴다. 칸 이름을 지어내지 마라
- 확신이 없으면 넣지 마라. 빠진 칸은 사람이 넣는다

칸 이름 (이 목록 밖의 이름은 쓰지 않는다)
${FIELD_LIST}

출력은 JSON 하나만:
{"suggestions":[{"clause":1,"text":"원문 그대로의 글자","field":"칸 이름"}]}
없으면 {"suggestions":[]}

원문
${input}`,
}
