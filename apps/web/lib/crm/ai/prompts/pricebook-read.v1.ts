/**
 * 가격표 문서 → 가격 기준 초안 프롬프트 v1 (P0135 I12)
 *
 * 견적서 읽기(quote-from-doc)와 같은 원칙이다. **옮기기만 한다.**
 *   ① 숫자는 문서에 적힌 그대로. 단위를 곱하지 않는다 — 곱하는 것은 규칙이 한다(import-draft.ts)
 *   ② 계산하지 않는다. 계산 예시도 적힌 숫자만 옮긴다
 *   ③ 비고에 적힌 관계(같이 들어감, 기본 포함, 상한)는 정해진 규칙 일곱 종류로만 옮긴다.
 *      맞는 종류가 없으면 unclear 에 적고 지어내지 않는다
 * 원가는 받지도 내지도 않는다.
 */

import type { AiPrompt } from '../runner.ts'

const TARGET_HINT: Record<string, string> = {
  product: '제품 가격표다. 제품 하나, 품목 여러 줄, 비고의 규칙과 할인, 계산 예시를 옮겨라.',
  items: '장비 단가표 또는 견적서다. 품목 줄만 옮겨라. rules, discounts, examples, grades 는 빈 배열.',
  labor: '노임단가 또는 인건비 단가표다. grades 만 옮겨라. 나머지는 빈 배열.',
}

export function pricebookReadPrompt(target: 'product' | 'items' | 'labor'): AiPrompt {
  return {
    version: 'pricebook_read@v1.1.0',
    build: (input: string) => `당신은 가격표를 우리 가격 기준 양식으로 **옮기는** 도구다. 해석도 계산도 하지 않는다.
${TARGET_HINT[target]}

## 지킬 것
- 금액은 문서에 적힌 숫자 그대로 쓴다. 「단위: 만원」 표에서 1,500 이면 1500 이다. 곱하지 마라.
- 문서의 금액 단위를 unit 에 적는다: 원, 천원, 만원, 백만원, 억원 가운데 하나. 못 찾으면 null.
- 「실사 후 견적」, 「별도 협의」처럼 금액이 없는 줄은 basis 를 SURVEY, price 를 null 로.
- 「계약 금액의 15%」처럼 다른 묶음의 비율이면 basis 를 RATIO, ratioPct 15, ratioOfSection 은 그 묶음 이름.
- 「GPU 1장당」, 「노드 1대당」, 「1회당」이면 PER_UNIT. 한 덩어리면 FIXED.
- 매년 나가는 것(유지보수)은 billing ANNUAL, 나머지는 ONCE.
- 할인 대상이 아니라고 적힌 묶음(구축비 등)은 discountable false.
- sourceText 에 그 줄의 원문을 짧게 옮긴다.

## 규칙은 이 여덟 종류만 쓴다 (품목은 이름으로 가리킨다)
- {"kind":"ONE_OF","items":[이름,…]}                 하나만 고른다
- {"kind":"WITH","item":이름,"with":[이름,…]}        고르면 같이 들어간다
- {"kind":"INCLUDES","item":이름,"items":[이름,…]}  기본 포함(0원)
- {"kind":"INCLUDES","item":이름,"varKey":"nodes","qty":20}  수를 기본 포함
- {"kind":"QTY_FROM","item":이름,"varKey":"gpu.dc|gpu.ws|gpu.timed|gpu.total|nodes|training","minusIncluded":true|false}
- {"kind":"CAP","item":이름,"varKey":…,"max":300}   상한
- {"kind":"ELIGIBLE","item":이름,"classes":["DC","WS","CONSUMER","NPU"]}
- {"kind":"SCALE_CAP","section":묶음 이름,"varKey":"gpu.total","perUnitWon":숫자}  정가 소계가 수 × 금액을 넘으면 넘는 만큼 할인. perUnitWon 도 문서 숫자 그대로(단위를 곱하지 마라)
할인은 discounts 에: {"label":"교육기관","companyKind":"school|government|public|research|company|nonprofit|partner","pct":10,"confirmed":false}

## 계산 예시
문서에 계산 예시가 있으면 examples 에 옮긴다.
- picked: 고른 에디션, 옵션, 유지보수 품목 이름. **GPU 라이선스 품목은 넣지 마라.** 그 수량은 GPU 장수에서 나온다
- gpus: 예시에 적힌 GPU 를 모델 이름, 장수, 지정 시간 여부(timed)로. 「H100 4장」이면 {"model":"H100","count":4,"timed":false}
- 「STD 옵션은 GPU 분할, 사용자 포털 포함」처럼 적혀 있으면 그 옵션 품목 이름을 picked 에 넣는다
- 연 유지보수 금액이 적혀 있으면 그 유지보수 품목(표준 등)을 picked 에 넣는다
- nodes, 적힌 금액(expectOnce 초기 도입, expectAnnual 연 유지보수, expectTco 총비용)

## 출력 (JSON 하나만)
{"unit":…,"product":{"name":…,"businessType":"SOLUTION|GPU|SI|HARDWARE|MSP|PROJECT|CREDIT|OTHER"}|null,
 "sections":[{"name":…,"roundingUnitWon":10000|null}],
 "items":[{"name":…,"section":…,"price":…,"basis":…,"unit":…,"billing":…,"ratioPct":…,"ratioOfSection":…,"discountable":…,"remark":…,"sourceText":…}],
 "rules":[…],"discounts":[…],"examples":[…],
 "grades":[{"name":"특급","publicRate":…,"price":…,"effectiveFrom":"YYYY-MM-DD"|null,"sourceText":…}],
 "unclear":[못 옮긴 것을 한 줄씩]}

## 원문
${input}`,
  }
}
