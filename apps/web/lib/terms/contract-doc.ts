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

/** 계약서 서버 메시지 — 화면이 그대로 보여 준다 */
export const CONTRACT_MSG = {
  templateNameRequired: '템플릿 이름을 입력해 주세요.',
  templateNotFound: '템플릿을 찾을 수 없습니다.',
  templateConflict: '다른 사람이 이 템플릿을 먼저 고쳤습니다. 새로고침 후 다시 시도해 주세요.',
  templateNoClauses: '조항이 하나도 없어 발행할 수 없습니다.',
  templateNotPublished: '아직 발행하지 않은 템플릿입니다. 설정의 계약 탭에서 발행한 뒤 쓸 수 있습니다.',
  unknownFields: (names: string): string => `모르는 칸이 있습니다: ${names}. 「칸 넣기」에서 골라 넣어 주세요.`,
  badClauses: (why: string): string => `조항을 저장하지 못했습니다. ${why}`,
  notFound: '계약서를 찾을 수 없습니다.',
  versionNotFound: '그 버전을 찾을 수 없습니다.',
  conflict: '다른 사람이 이 계약서를 먼저 고쳤습니다. 새로고침 후 다시 시도해 주세요.',
  quoteNotContractable: '보냈거나 수락된 견적으로만 계약서를 만들 수 있습니다. 작성 중 견적은 아직 고객과 합의한 값이 아닙니다.',
  quoteExpired: '유효기간이 지난 견적입니다. 개정본을 보낸 뒤 그 견적으로 만들어 주세요.',
  noTemplate: '쓸 수 있는 계약서 템플릿이 없습니다. 설정의 계약 탭에서 템플릿을 발행해 주세요.',
  notWritable: '체결했거나 끝난 계약서는 고칠 수 없습니다. 바꾸려면 변경 계약서를 만들어 주세요.',
  noClauses: '조항이 하나도 없는 계약서는 저장할 수 없습니다.',
  badField: (key: string): string => `계약서에 넣을 수 없는 칸입니다: ${key}`,
  fieldTooLong: (label: string): string => `「${label}」 값이 너무 깁니다.`,
  titleRequired: '계약서 제목을 입력해 주세요.',
  numberTaken: '같은 계약서 번호가 방금 쓰였습니다. 다시 시도해 주세요.',
  dealRequired: '어느 딜의 계약서인지 알려 주세요.',
  badVersionNo: '버전 번호가 올바르지 않습니다.',
} as const

/** 버전이 생긴 까닭 — 버전 기록에 이 말로 보인다 */
export const CONTRACT_VERSION_KIND: Record<string, string> = {
  GENERATED: '견적으로 만듦',
  EDITED: '손으로 고침',
  AI_EDIT: 'AI 지시로 고침',
  REFILLED: '견적으로 다시 채움',
}

/** 템플릿 화면 말 */
export const CONTRACT_TEMPLATE = {
  cardTitle: '계약서 템플릿',
  cardDesc: '계약서를 만들 때 쓰는 조항 묶음입니다. 사업 유형마다 기본 템플릿을 하나 정하면 그 유형의 딜에서 먼저 골라집니다.',
  editTitle: '템플릿 고치기',
  loadFailed: '계약서 템플릿을 불러오지 못했습니다.',
  saveFailed: '템플릿을 저장하지 못했습니다.',
  publishFailed: '템플릿을 발행하지 못했습니다.',
  deleteFailed: '템플릿을 삭제하지 못했습니다.',
  deleteTitle: (name: string): string => `「${name}」 템플릿을 삭제할까요?`,
  deleteBody: '휴지통으로 옮깁니다. 이 템플릿으로 이미 만든 계약서는 그때 버전을 그대로 갖고 있어 바뀌지 않습니다.',
  create: '새 템플릿',
  name: '템플릿 이름',
  namePlaceholder: '예: GPU 임대 계약서',
  businessType: '사업 유형',
  allTypes: '모든 사업 유형',
  isDefault: '이 사업 유형의 기본 템플릿',
  defaultBadge: '기본',
  inUse: (n: number): string => `사용 중 · 버전 ${n}`,
  neverPublished: '발행 전',
  hasDraft: '발행 안 한 고침 있음',
  insertField: '칸 넣기',
  pickField: '넣을 칸 고르기',
  addClause: '조항 넣기',
  clauseTitle: '조항 제목',
  clauseTitlePlaceholder: '예: 제1조 (목적)',
  removeClause: '조항 빼기',
  moveUp: '위로',
  moveDown: '아래로',
  saveDraft: '저장',
  publish: (n: number): string => `버전 ${n} 발행`,
  publishWhy: '발행해야 계약서 만들기에 쓰입니다. 이미 만든 계약서는 바뀌지 않습니다.',
  empty: '계약서 템플릿이 아직 없어요',
  emptyNext: '조항을 쓰고 칸을 넣어 첫 템플릿을 만들어 주세요.',
  fieldHelp: '칸은 계약서를 만들 때 견적과 계약 정보로 채워집니다. 모르는 칸 이름은 저장되지 않습니다.',
} as const

/** 계약서 파일로 템플릿 만들기 (I07) */
export const CONTRACT_FROM_FILE = {
  open: '파일로 만들기',
  title: '계약서 파일로 템플릿 만들기',
  intro: '쓰고 있는 계약서 파일을 올리면 조항을 나누고, 계약마다 바뀌는 글자를 칸으로 바꿔 둡니다. 원문 글은 고치지 않습니다.',
  accept: 'PDF, 워드, 한글, 텍스트 파일 (20MB 이내)',
  pick: '파일 고르기',
  start: '읽기',
  attachFailed: '템플릿은 만들었지만 원본 파일을 남기지 못했습니다.',
  defaultName: '새 계약서 템플릿',
  imageNotSupported: '그림 파일은 아직 읽지 못합니다. PDF 나 워드로 올려 주세요.',
  parseFailed: '파일을 읽지 못했어요. 다른 형식으로 저장한 뒤 다시 올려 주세요.',
  noText: '파일에서 글자를 찾지 못했어요. 스캔한 계약서라면 글자가 든 PDF 나 워드로 올려 주세요.',
  aiFailed: 'AI 가 칸 자리를 찾지 못했습니다.',
  reject: {
    too_large: '파일이 너무 큽니다. 20MB 이내로 올려 주세요.',
    unsupported_kind: '이 형식은 읽을 수 없어요. PDF, 워드, 한글 파일로 올려 주세요.',
    bundle_not_allowed: '압축 파일은 받지 않습니다. 계약서 파일 하나를 올려 주세요.',
    kind_mismatch: '파일 이름과 내용의 형식이 다릅니다. 원래 형식으로 저장한 뒤 올려 주세요.',
    empty: '빈 파일입니다.',
  },
  doneTitle: '템플릿을 만들었습니다',
  doneFields: (n: number): string => `칸 ${n}곳을 넣었습니다. 발행 전에 확인해 주세요.`,
  doneNoFields: '칸은 넣지 않았습니다. 「칸 넣기」로 직접 넣을 수 있습니다.',
  aiSkipped: (why: string): string => `글만 들였습니다. ${why}`,
  truncated: '계약서가 길어 뒷부분은 읽지 못했습니다. 빠진 조항은 직접 넣어 주세요.',
  rejectedCount: (n: number): string => `원문과 맞지 않거나 없는 칸 이름을 짚은 제안 ${n}건은 넣지 않았습니다.`,
  sourceFile: (name: string): string => `원본 파일: ${name}`,
  failed: '파일로 템플릿을 만들지 못했습니다.',
} as const
