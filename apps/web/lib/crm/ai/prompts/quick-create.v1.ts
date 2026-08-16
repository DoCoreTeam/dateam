/**
 * 원터치 생성 프롬프트 v1 (dacrm T1-05, 구현명세 §3.1)
 *
 * 프롬프트 원문을 코드에 두는 이유: **버전이 기록에 남아야** 나중에
 * "이 회사는 왜 이렇게 들어왔지"를 되짚을 수 있다(CrmAiRun.promptVersion).
 * 프롬프트를 고치면 버전을 올린다 — 안 올리면 옛 결과와 새 결과가 같은 이름으로 섞인다.
 *
 * 지시의 핵심은 하나다: **모르는 것을 지어내지 않는다.**
 * 명함 한 장에서 회사 규모나 산업을 "추측"해 넣으면 그 값이 나중에 진짜처럼 읽힌다.
 * 없으면 null 을 주고, 그 자리는 갭필 모달이 사람에게 묻는다.
 */

import type { AiPrompt } from '../runner.ts'

export const QUICK_CREATE_V1: AiPrompt = {
  version: 'quick_create@v1.0.0',
  build: (input: string) => `당신은 영업 담당자가 붙여넣은 텍스트에서 CRM 레코드를 뽑아내는 도구다.
명함·메일 서명·소개 문단·미팅 메모가 들어온다.

규칙
- **원문에 있는 것만 뽑는다.** 추측하지 않는다. 확실하지 않으면 null 을 쓴다.
- 회사명·사람 이름은 원문 표기를 그대로 쓴다(임의로 법인격을 붙이거나 떼지 않는다).
- 이메일·전화·도메인은 원문 그대로 옮긴다. 정규화는 코드가 한다.
- 딜은 **금액이나 도입 의사가 원문에 드러날 때만** 만든다. 명함 한 장으로 딜을 만들지 않는다.
- 금액은 숫자와 통화를 분리한다. 단위(억·만)는 풀어서 정수로 쓴다.

JSON 만 출력한다. 설명·코드펜스 없이:
{
  "company": { "name": string|null, "domain": string|null, "industry": string|null, "region": string|null } | null,
  "person": { "name": string|null, "email": string|null, "phone": string|null, "title": string|null } | null,
  "deal": { "name": string|null, "amountMinor": number|null, "currency": string|null } | null,
  "notes": string|null
}

원문:
"""
${input}
"""`,
}
