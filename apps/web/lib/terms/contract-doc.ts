/**
 * 문서의 말 — 견적서와 계약서가 같은 말을 쓴다 (용어집 §0-2 「문서 말」)
 *
 * **왜 따로 있나**: 같은 「다시 만든 본」을 견적은 개정본·Rev.N, 마감은 수정본·N판,
 * 트레이딩은 판, AI 화면은 리비전이라 불렀다(실측 2026-10-16, 화면 문구 2,094파일).
 * 사용자 지적은 「판이라는 표현이 맞는지 전체 시스템에 키워드나 워딩좀 제발」.
 *
 * 그래서 문서에 붙는 말은 여기 한 곳에 둔다. 계약서 화면은 처음부터 여기만 쓴다.
 *
 * **`contract.ts` 와 다르다.** 그쪽 「계약」은 AI 결과의 데이터 규칙(스키마) 번호다.
 * 이 파일의 계약서는 고객과 맺는 문서다. 이름이 겹치지 않게 파일을 갈랐다.
 */

/** 같은 문서를 저장할 때마다 남는 기록 하나 */
export const versionLabel = (n: number): string => `버전 ${n}`

export const DOC = {
  versionHistory: '버전 기록',
  compareVersions: '두 버전 비교',
  /** 고객에게 다시 내는 새 견적 — 견적서에 Rev.N 으로 인쇄된다 */
  revision: '개정본',
  template: '템플릿',
  /** 고객에게 보냈다는 기록. 상태가 아니라 체크다 */
  sent: '보냄',
  sentOn: (date: string): string => `보냄 ${date}`,
  /** 양측이 날인해 계약이 성립함 */
  concluded: '체결',
  signedCopy: '서명본',
  amendment: '변경 계약서',
} as const

/** 계약서 */
export const CONTRACT_DOC = {
  entity: '계약서',
  create: '계약서 만들기',
  open: '계약서 열기',
  list: '계약서',
  edit: '고치기',
  aiEdit: 'AI로 고치기',
} as const

/** 빈 칸 자리에 찍히는 말 — 빈 자리가 안 보이면 대표자 이름 빠진 계약서가 그대로 나간다 */
export const EMPTY_FIELD = '(미입력)'

/**
 * 템플릿에 적는 칸 이름 — {{고객.상호}} 의 그 이름.
 * 칸의 뜻과 출처는 `lib/crm/domain/contract-fields.ts` 의 `CONTRACT_FIELDS` 가 정한다.
 */
export const CONTRACT_FIELD_LABEL: Record<string, string> = {
  'supplier.name': '공급자.상호',
  'supplier.ceo': '공급자.대표자',
  'supplier.bizNo': '공급자.사업자번호',
  'supplier.address': '공급자.주소',
  'customer.name': '고객.상호',
  'customer.contact': '고객.담당자',
  'customer.ceo': '고객.대표자',
  'customer.bizNo': '고객.사업자번호',
  'customer.address': '고객.주소',
  'quote.no': '견적.번호',
  'quote.title': '견적.사업명',
  'quote.issuedOn': '견적.작성일',
  'quote.supply': '견적.공급가액',
  'quote.tax': '견적.부가세',
  'quote.total': '견적.합계',
  'quote.totalInWords': '견적.합계 한글',
  'quote.start': '견적.공급 시작일',
  'quote.end': '견적.공급 끝일',
  'quote.lines': '견적.품목표',
  'quote.terms': '견적.거래 조건',
  'owner.name': '담당.이름',
  'contract.no': '계약.번호',
  'contract.date': '계약.계약일',
  'contract.start': '계약.시작일',
  'contract.end': '계약.끝일',
}
