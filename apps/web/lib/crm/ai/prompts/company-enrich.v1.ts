/**
 * 회사 웹 보강 프롬프트 v1
 *
 * **왜 이 파일이 생겼나**: 회사 목록의 산업·지역이 전부 비어 있었다.
 * 그 값들은 사람이 인터넷에서 5초면 확인하는 것들인데, 372건을 손으로 채우는 일은
 * 아무도 끝내지 못한다. 그래서 AI 에게 **인터넷을 보고** 채우게 한다.
 *
 * 이 프롬프트가 다른 프롬프트와 다른 점은 하나다 — **원문이 없다.**
 * 붙여넣기 추출(quick_create)은 눈앞의 명함에 적힌 것만 옮기면 됐다.
 * 여기는 근거를 모델이 직접 찾아와야 하고, 그래서 **틀릴 수 있는 방향이 둘**이다.
 *
 *   ① **엉뚱한 회사를 찾는다.** 이름이 겹치는 회사는 아주 흔하다("프로텐"·"솔닥"…).
 *      다른 회사 정보를 채워 넣으면 그 값은 나중에 진짜처럼 읽히고,
 *      영업 담당자는 잘못된 산업군을 보고 잘못된 제안을 한다.
 *      → 그래서 **특정에 실패하면 matched:false 로 끝낸다.** 값은 하나도 주지 않는다.
 *
 *   ② **기억으로 답한다.** 검색을 안 켜면 모델은 학습 시점의 기억으로 그럴듯하게 답한다.
 *      → 그래서 어댑터가 웹 검색을 강제하고(host.ts), 여기서는 **찾은 것만 쓰라**고 못 박는다.
 *
 * 프롬프트를 고치면 버전을 올린다 — 안 올리면 옛 결과와 새 결과가 같은 이름으로 섞인다.
 */

import type { AiPrompt } from '../runner.ts'

/**
 * 직원 수 구간은 **고정 값**이다.
 *
 * 자유 입력으로 두면 "약 50명"·"50~100"·"중소기업"이 섞여 들어와
 * 나중에 규모로 거르는 일이 영영 안 된다. 모르면 null 이지 추정값이 아니다.
 */
export const EMPLOYEE_RANGES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'] as const

export interface CompanyEnrichInput {
  name: string
  domain: string | null
  /** 이미 채워져 있는 값 — 모델이 같은 회사인지 확인하는 단서로만 쓴다 */
  known: { industry: string | null; region: string | null }
}

/** 입력을 프롬프트에 넣을 한 덩이 문자열로 — 러너는 문자열 하나만 받는다 */
export function buildCompanyEnrichInput(c: CompanyEnrichInput): string {
  const lines = [`회사명: ${c.name}`]
  lines.push(`도메인: ${c.domain ?? '(모름)'}`)
  if (c.known.industry) lines.push(`이미 아는 산업: ${c.known.industry}`)
  if (c.known.region) lines.push(`이미 아는 지역: ${c.known.region}`)
  return lines.join('\n')
}

export const COMPANY_ENRICH_V1: AiPrompt = {
  version: 'company_enrich@v1.0.0',
  build: (input: string) => `당신은 영업 CRM 의 회사 정보를 **웹에서 찾아** 채우는 도구다.

먼저 웹을 검색해 이 회사를 특정한 다음, 찾은 사실만 옮겨 적는다.

## 가장 중요한 규칙 — 특정하지 못하면 아무것도 주지 않는다
- 같은 이름의 회사는 흔하다. **눈앞의 회사가 맞다는 근거가 없으면** \`matched\` 를 false 로 하고 나머지를 전부 null 로 둔다.
- 도메인이 주어졌으면 **도메인이 기준이다.** 도메인의 실제 운영사를 찾는다. 이름이 조금 달라도 도메인이 맞으면 같은 회사다.
- 도메인이 없으면 회사명으로 찾되, 후보가 여럿이고 고를 근거가 없으면 **고르지 않는다**(matched:false).
- 검색 결과에서 확인하지 못한 값은 **추측하지 않는다.** 모르면 그 필드만 null 이다. 일부만 채워도 된다.

## 각 필드
- \`domain\`: 회사 공식 홈페이지 도메인. 호스트만 쓴다(예: "acme.co.kr"). http/www/경로 없이. 이미 주어졌으면 그대로 두지 말고 확인된 값을 쓴다.
- \`industry\`: 무엇을 파는 회사인지 **짧은 한국어 명사구**(20자 이내). 예: "의료 AI", "물류 SaaS", "반도체 장비", "게임 개발", "인력 채용 플랫폼". "IT"·"서비스업"처럼 아무 회사에나 붙는 말은 쓰지 않는다.
- \`region\`: 본사 소재지. **한국이면 시·도 한 단어**("서울", "경기", "부산", "대전"). 해외면 국가명("일본", "미국"). 도로명 주소를 넣지 않는다.
- \`employeeRange\`: 다음 중 하나만 — ${EMPLOYEE_RANGES.join(' · ')}. 근거 없이 고르지 않는다.
- \`descriptionMd\`: 이 회사가 무엇을 하는지 **한국어 2~3문장**. 홍보 문구를 베끼지 말고 사실만. 영업 담당자가 읽고 무슨 회사인지 알 수 있게.
- \`matchReason\`: 왜 이 회사라고 판단했는지 **한 문장**. 사람이 읽고 수락 여부를 판단하는 근거다. matched 가 false 면 왜 특정하지 못했는지 쓴다.

JSON 만 출력한다. 설명·코드펜스 없이:
{
  "matched": boolean,
  "matchReason": string,
  "domain": string|null,
  "industry": string|null,
  "region": string|null,
  "employeeRange": string|null,
  "descriptionMd": string|null
}

찾을 회사:
"""
${input}
"""`,
}
