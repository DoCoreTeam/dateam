/**
 * 가격 기준 용어 (SSOT) — 기획 「견적은 기준을 안다」
 *
 * 화면은 이 파일의 값만 쓴다. 새 말은 여기 먼저 넣고 docs/ui-system/GLOSSARY.md 에도 적는다.
 * 있는 말(품목, 묶음, 정상가, 비율, 절사, 할인 승인, 원본 대조, 말로 채우기, 기관 종류)은
 * 다른 파일의 값을 그대로 쓴다.
 */

import type { ItemBasis, ProvenanceSource, RuleKind, GpuClass, PriceSource } from '../crm/domain/pricebook/types.ts'
import type { Billing } from '../crm/domain/quote-compose.ts'

export const PRICEBOOK = {
  /** 메뉴와 화면 이름 — 예전 「품목」 탭이 넓어졌다 */
  title: '가격 기준',
  tabProduct: '제품',
  tabItem: '품목',
  tabLabor: '인건비 등급',
  newProduct: '새 제품',
  newItem: '새 품목',
  newGrade: '새 등급',
  importFile: '파일 가져오기',
  searchProduct: '제품 이름으로 찾기',
  searchItem: '품목 이름으로 찾기',
  productName: '제품 이름',
  businessType: '사업 유형',
  itemCount: '품목',
  ruleCount: '규칙',
  updatedAt: '수정일',
  status: '상태',
  onSale: '판매 중',
  stopped: '판매 중지',
  // 품목 탭 — 끌어 놓기와 여러 개 한꺼번에(P0138)
  itemSearch: '품목 찾기',
  hideStopped: '판매 중지 숨기기',
  resume: '다시 판매',
  moveTo: '묶음 옮기기',
  duplicate: '복제',
  dropHere: '여기에 놓으면 이 묶음으로 옮겨요',
  dragHint: '손잡이를 끌어 순서를 바꾸고, 다른 묶음 칸에 놓으면 그 묶음으로 옮겨요',
  bulkDone: (n: number) => `${n}개를 바꿨어요`,
  searching: '찾는 동안에는 순서를 바꿀 수 없어요',
  // 묶음 관리(P0138)
  sectionNew: '새 묶음 이름',
  sectionAdd: '묶음 추가',
  sectionRename: (name: string) => `${name} 묶음 이름`,
  sectionInUse: (n: number) => `품목 ${n}개가 남아 있어 지울 수 없어요. 품목을 다른 묶음으로 옮긴 뒤 지우세요`,
  sectionNameClash: '묶음 이름이 비었거나 겹쳐요',
  // 총비용 계산(미리 계산 탭으로 옮김)
  tcoNotInQuote: '미리 계산에만 쓰이고 견적에는 안 쓰여요',
  // 규칙과 할인 탭(P0138)
  ruleTurnOn: '켜기',
  ruleTurnOff: '끄기',
  confirmProposal: '제안값 확정',
  ruleDeleteTitle: '이 규칙을 지울까요?',
  ruleOffReason: (reason: string) => `꺼 둠: ${reason}`,
  rulesDisabled: (n: number) => `규칙 ${n}개는 모양이 맞지 않아 끈 채로 저장했어요. 사유를 보고 고치세요.`,
  stopSale: '판매 중지',
  resumeSale: '다시 판매',
  unsorted: '정리 전',
  autoRegistered: '견적에서 자동 등록',
  noProduct: '제품 없음',
  needsReview: '확인 전',
  confirm: '확인',
  confirmed: '확인함',
  // 상세 탭
  detailInfo: '기본 정보',
  detailItems: '품목',
  detailRules: '규칙',
  detailDiscounts: '할인',
  detailPreview: '미리 계산',
  detailHistory: '변경 이력',
  // 품목 칸
  section: '묶음',
  listPrice: '정상가',
  basis: '가격 기준',
  billing: '청구',
  unit: '단위',
  spec: '규격',
  remark: '비고',
  ratioPct: '비율(%)',
  ratioOf: '비율 대상 묶음',
  discountable: '할인 대상',
  taxRate: '세율(%)',
  survey: '실사 후 견적',
  sectionRounding: '묶음 절사',
  aliases: '다른 이름',
  usedInQuotes: '이 품목을 쓴 견적',
  // 인건비 등급 칸
  gradeName: '등급',
  gradeRole: '역할',
  gradeCost: '원가(월)',
  gradePrice: '판매 단가(월)',
  gradePublic: '공표 노임단가(월)',
  gradeFrom: '적용 시작일',
  // 미리 계산
  previewRun: '계산',
  previewOnce: '초기 도입 금액',
  previewAnnual: '연 유지보수',
  previewTco: (years: number) => `${years}년 총비용`,
  previewMatches: '가격표의 계산 예시와 같아요',
  previewDiffers: '가격표의 계산 예시와 달라요',
  example: '계산 예시',
  // 변경 이력
  historyFrom: '바뀌기 전',
  historyTo: '바뀐 뒤',
  historyWho: '누가',
  historyWhere: '어디서',
  historyByHand: '손으로 수정',
  historyByFile: (name: string) => `파일 ${name}`,
  historyEmpty: '아직 바뀐 적이 없어요',
  // 견적 쪽
  fillByProduct: '제품으로 채우기',
  conditions: '조건',
  editConditions: '조건 고치기',
  putInQuote: '견적에 넣기',
  autoFilled: '자동으로 채운 값',
  autoFixed: '자동으로 고친 값',
  revert: '되돌리기',
  baselineCheck: '기준 대조',
  baselineChanged: '기준이 바뀌었어요',
  refill: '다시 채우기',
  budget: '예산',
  budgetIncludesTax: '부가세 포함',
  fitBudget: '예산에 맞추기',
  dealBudget: '딜 예산',
  oneTime: '1회',
  annual: '매년',
  lockedByHuman: '사람이 고침',
  conditionDiffers: '조건과 다름',
  // 전환 규칙(P0137) — 이미 산 품목에서 바꿀 품목으로
  upgradeFrom: '이미 산 품목',
  upgradeTo: '바꿀 품목',
  upgradeItem: '들어갈 품목',
  ownedFrom: (name: string) => `기존 ${name} 고객`,
  ownedEvidence: (note: string) => `지난 계약: ${note}`,
  ownedNone: '지난 계약에서 찾지 못함',
  importAccepts: '엑셀, PDF, 워드, 한글, 이미지',
  // 기본 정보 탭(P0137 I01b) — 칸마다 이름과 단위, 그 값이 견적에 어떻게 쓰이는지
  infoProduct: '제품',
  tcoYears: '총비용 기간',
  freeYears: '유지보수 무상 기간',
  yearUnit: '년',
  tcoExplain: (years: number, free: number) => {
    const paid = Math.max(0, years - free)
    if (free <= 0) return `${years}년 총비용 = 한 번 내는 금액 + 매년 내는 금액 × ${years}년`
    return `${years}년 총비용 = 한 번 내는 금액 + 매년 내는 금액 × ${paid}년 (첫 ${Math.min(free, years)}년 무상)`
  },
  sectionsMeta: '견적서에 이 순서로 묶여 나와요',
  sectionsHint: '손잡이를 끌거나 위 아래 단추로 순서를 바꿔요',
  roundingNone: '절사 안 함',
  roundingUnder: (unit: string) => `${unit} 미만 절사`,
  saleStatus: '판매 상태',
  onSaleHint: '견적의 제품으로 채우기에서 고를 수 있어요',
  offSaleHint: '견적에서 고를 수 없어요. 지난 견적은 그대로예요',
  unsaved: '저장하지 않은 변경이 있어요',
  noChanges: '바뀐 것 없음',
  discardChanges: '되돌리기',
} as const

export const ITEM_BASIS_LABEL: Record<ItemBasis, string> = {
  FIXED: '1식',
  PER_UNIT: '단위당',
  RATIO: '비율',
  SURVEY: '실사 후 견적',
}

export const BILLING_LABEL: Record<Billing, string> = {
  ONCE: '1회',
  ANNUAL: '매년',
}

/** 견적 한 칸이 받는 가격 기준 넷과 직접 입력 */
export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  LIST: '품목 정상가',
  LABOR: '등급 단가',
  GPU: 'GPU 판매가',
  COST_MARGIN: '원가와 마진율',
  MANUAL: '직접 입력',
}

/** 출처 표시 — 견적 편집 화면에만 서고 견적서에는 안 실린다 */
export const PROVENANCE_LABEL: Record<ProvenanceSource, string> = {
  HUMAN: '사람이 고침',
  SAID: '말한 값',
  BUDGET: '예산 맞추기',
  RULE: '품목 규칙',
  PRICEBOOK: '가격 기준',
  GPU_PRICE: 'GPU 판매가',
  COST_MARGIN: '원가와 마진율',
  LAST_QUOTE: '지난 견적',
  PUBLIC_LABOR: '공표 노임단가',
  COMPANY_KIND: '기관 종류',
  DEAL_BUDGET: '딜 예산',
  DEFAULT: '기본값',
  UNVERIFIED: '확인 전 가격',
  AI_REVIEW: 'AI 검토',
}

export const RULE_KIND_LABEL: Record<RuleKind, string> = {
  ONE_OF: '하나만 고름',
  WITH: '같이 들어감',
  INCLUDES: '기본 포함',
  QTY_FROM: '수량 따라감',
  CAP: '상한',
  ELIGIBLE: '고를 수 있는 조건',
  DISCOUNT: '할인',
  SCALE_CAP: '규모 조정',
  UPGRADE: '전환',
}

export const GPU_CLASS_LABEL: Record<GpuClass, string> = {
  DC: '데이터센터용',
  WS: '워크스테이션용',
  CONSUMER: '데스크톱용',
  NPU: 'NPU',
}

export const VAR_LABEL: Record<string, string> = {
  'gpu.dc': '데이터센터 GPU 장수',
  'gpu.ws': '워크스테이션과 데스크톱 GPU 장수',
  'gpu.timed': '지정 시간 GPU 장수',
  'gpu.total': 'GPU 합계',
  nodes: '노드 수',
  training: '추가 교육 횟수',
}

/** 가격표 검증 일곱 겹 — 화면이 「무엇에 걸렸나」를 말할 때 */
export const IMPORT_CHECK_LABEL = {
  file: '파일 형식과 크기',
  source: '원문 대조',
  unit: '단위',
  rule: '규칙 모양',
  example: '계산 예시 재현',
  diff: '차이 보기',
  side: '나란히 보기',
} as const

export const IMPORT_SENTENCE = {
  sourceMissing: '이 숫자를 원문에서 못 찾았어요',
  unitWrong: '단위를 곱하지 않은 것 같아요',
  ruleOff: '이 규칙은 모양이 맞지 않아 끈 채로 저장해요',
  removedStopped: '새 파일에 없어서 판매 중지로 둬요',
  readFailed: '파일을 읽지 못했어요',
  aiDown: 'AI가 지금 답하지 않아 파일을 못 읽었어요',
} as const

/** 예산 맞추기의 결과 한 줄 — 단가는 그대로 두고 할인 칸으로 맞춘 것을 말한다 */
export const BUDGET_SENTENCE = {
  fitted: (pct: number, achieved: string) => `할인 대상 줄에 할인 ${pct}% 를 넣어 ${achieved}원으로 맞췄어요. 단가는 그대로예요.`,
  fittedGap: (pct: number, achieved: string, gap: string) => `할인 ${pct}% 로 ${achieved}원이에요. 예산보다 ${gap}원 적어요(할인율은 소수 둘째 자리까지라).`,
  alreadyUnder: (gap: string) => `이미 예산 안이에요. 예산이 지금 금액보다 ${gap}원 남아요. 값을 올리지 않아요.`,
  notEnough: (pct: number, achieved: string, gap: string) => `할인 대상 줄을 다 깎아도 예산에 못 닿아요. 구성이 예산보다 커요. 할인 ${pct}% 까지만 넣어 ${achieved}원이고 예산보다 ${gap}원 많아요.`,
  overCap: (pct: number, achieved: string, gap: string, needed: number) => `예산에 맞추려면 할인 ${needed}% 가 필요해요. 승인 기준을 넘어 ${pct}% 까지만 넣었어요(${achieved}원, 예산보다 ${gap}원 많음).`,
  applyNeeded: (needed: number) => `할인 ${needed}% 넣기`,
  noDiscountable: '할인할 수 있는 줄이 없어요. 구축비, 비율 줄, 사람이 잠근 할인은 맞추기에서 빠져요.',
  approval: '할인 승인 기준을 넘어 보내기 전에 승인이 필요해요.',
  dealBudget: (v: string) => `딜 예산 ${v}원`,
} as const
