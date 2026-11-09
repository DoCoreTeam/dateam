import { withJosa, eulReul, euroRo } from '../ui/josa.ts'

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
  'supplier.phone': '공급자.전화번호',
  'customer.name': '고객.상호',
  'customer.contact': '고객.담당자',
  'customer.ceo': '고객.대표자',
  'customer.bizNo': '고객.사업자번호',
  'customer.address': '고객.주소',
  'customer.phone': '고객.전화번호',
  'customer.birth': '고객.생년월일',
  'quote.no': '견적.번호',
  'quote.title': '견적.사업명',
  'quote.issuedOn': '견적.작성일',
  'quote.supply': '견적.공급가액',
  'quote.tax': '견적.부가세',
  'quote.total': '견적.합계',
  'quote.annual': '견적.연유지보수',
  'quote.totalInWords': '견적.합계 한글',
  'quote.start': '견적.공급 시작일',
  'quote.end': '견적.공급 끝일',
  'quote.lines': '견적.품목표',
  'quote.terms': '견적.거래 조건',
  'owner.name': '담당.이름',
  'owner.phone': '담당.전화번호',
  'contract.no': '계약.번호',
  'contract.date': '계약.계약일',
  'contract.start': '계약.시작일',
  'contract.end': '계약.끝일',
  'contract.scope': '계약.수행범위',
  'contract.payment': '계약.지급일정',
  'partyA.name': '갑.상호',
  'partyA.ceo': '갑.대표자',
  'partyA.bizNo': '갑.사업자번호',
  'partyA.address': '갑.주소',
  'partyA.phone': '갑.전화번호',
  'partyB.name': '을.상호',
  'partyB.ceo': '을.대표자',
  'partyB.bizNo': '을.사업자번호',
  'partyB.address': '을.주소',
  'partyB.phone': '을.전화번호',
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
  sensitivityDenied: '회사 단위 계약은 관리자만 만들 수 있습니다.',
  versionNotFound: '그 버전을 찾을 수 없습니다.',
  conflict: '다른 사람이 이 계약서를 먼저 고쳤습니다. 새로고침 후 다시 시도해 주세요.',
  quoteNotContractable: '보냈거나 수락된 견적으로만 계약서를 만들 수 있습니다. 작성 중 견적은 아직 고객과 합의한 값이 아닙니다.',
  quoteExpired: '유효기간이 지난 견적입니다. 개정본을 보낸 뒤 그 견적으로 만들어 주세요.',
  noTemplate: '쓸 수 있는 계약서 템플릿도, 승인된 공통 조항 모듈도 없습니다. 설정의 계약 탭에서 템플릿을 발행하거나 모듈의 조항을 승인해 주세요.',
  notWritable: '체결했거나 끝난 계약서는 고칠 수 없습니다. 바꾸려면 변경 계약서를 만들어 주세요.',
  noClauses: '조항이 하나도 없는 계약서는 저장할 수 없습니다.',
  badField: (key: string): string => `계약서에 넣을 수 없는 칸입니다: ${key}`,
  fieldTooLong: (label: string): string => `「${label}」 값이 너무 깁니다.`,
  titleRequired: '계약서 제목을 입력해 주세요.',
  numberTaken: '같은 계약서 번호가 방금 쓰였습니다. 다시 시도해 주세요.',
  dealRequired: '어느 딜의 계약서인지 알려 주세요.',
  badVersionNo: '버전 번호가 올바르지 않습니다.',
  notDeletable: '체결했거나 해지한 계약서는 삭제할 수 없습니다. 있었던 계약의 기록입니다.',
  notInTrash: '휴지통에서 계약서를 찾을 수 없습니다.',
  badDirection: '계약 방향을 골라 주세요. 매출, 매입, 제휴, 공동수급, 3자, 회사 단위 중 하나입니다.',
  badFormOwner: '계약서 양식이 누구 것인지 골라 주세요.',
  badDocLayer: '계약서 종류를 골라 주세요.',
  dealNotFound: '연결할 딜을 찾을 수 없습니다.',
} as const

/** 계약 당사자 말 (P0184 I03) */
export const CONTRACT_PARTY_MSG = {
  required: '당사자를 한 명 이상 넣어 주세요.',
  tooMany: (max: number): string => `당사자는 ${max}명까지 넣을 수 있습니다.`,
  badShape: (n: number): string => `${n}번째 당사자의 모양이 올바르지 않습니다.`,
  badRole: (n: number): string => `${n}번째 당사자의 역할을 골라 주세요.`,
  nameRequired: (n: number): string => `${n}번째 당사자의 상호를 입력해 주세요.`,
  valueTooLong: (n: number): string => `${n}번째 당사자의 값이 너무 깁니다.`,
  selfOnce: '우리 회사는 당사자 중 한 번만 넣을 수 있습니다.',
  consortiumLead: '공동수급 계약은 주관사가 정확히 한 곳이어야 합니다.',
  companyNotFound: '당사자로 고른 회사를 찾을 수 없습니다.',
} as const

/** AI 로 고치기 말 (P0132 I09) */
export const CONTRACT_AI = {
  instructionRequired: '무엇을 고칠지 적어 주세요.',
  instructionTooLong: '지시가 너무 깁니다. 1,000자 안으로 줄여 주세요.',
  noPieces: '반영할 조각을 하나 이상 골라 주세요.',
  tooManyPieces: '한 번에 반영할 수 있는 조각 수를 넘었습니다.',
  badPiece: '반영할 조각의 모양이 올바르지 않습니다.',
  pieceStale: (n: number): string => `${n}번째 조각이 지금 본문과 맞지 않습니다. 다시 제안받아 주세요.`,
  numeric: '숫자나 날짜가 바뀝니다',
} as const

/** 조각을 버린 까닭 — 제안 목록에 이 말로 보인다 */
export const CONTRACT_AI_REJECT: Record<string, string> = {
  no_clause: '없는 조항을 가리킵니다',
  not_found: '지금 본문에 그 글이 없습니다',
  ambiguous: '같은 글이 여러 곳에 있어 어디인지 모릅니다',
  multiline: '여러 줄에 걸쳐 있습니다',
  broken_field: '칸 자리를 반만 건드립니다',
  unknown_field: '없는 칸 이름을 씁니다',
  same: '바뀌는 것이 없습니다',
}

/** 계약서 상태 이름 — 체결한 글은 굳고, 해지와 취소는 끝난 상태다 */
export const CONTRACT_STATUS_LABEL: Record<string, string> = {
  DRAFT: '작성 중',
  CONCLUDED: '체결',
  TERMINATED: '해지',
  CANCELLED: '취소',
}

/** 보냄 체결 해지 변경 계약서 말 (P0132 I10) */
export const CONTRACT_SIGN = {
  badAction: '할 수 없는 동작입니다.',
  adminOnly: '체결과 해지는 관리자만 할 수 있습니다.',
  sendOnlyDraft: '작성 중인 계약서만 보냄으로 표시할 수 있습니다.',
  badTransition: (from: string, to: string): string => `${from} 계약서는 ${to}(으)로 바꿀 수 없습니다.`,
  signedNotFound: '서명본 파일을 찾을 수 없습니다. 이 딜에 계약서 종류로 올린 파일만 고를 수 있습니다.',
  currencyMismatch: (deal: string, contract: string): string => `딜 통화(${deal})와 계약서 통화(${contract})가 달라 딜 금액에 넣을 수 없습니다.`,
  amountReason: (contractNo: string): string => `계약서 체결 ${contractNo}`,
  amendOnlyConcluded: '체결한 계약서에서만 변경 계약서를 만들 수 있습니다.',
  amendTitle: (title: string): string => `${title} 변경`,
  amendNote: (contractNo: string): string => `원 계약 ${contractNo} 에서 만듦`,
} as const

/** 견적 변경 알림과 다시 채우기 말 (P0132 I11) */
export const CONTRACT_REFILL = {
  quoteGone: '이 계약서를 만든 견적을 찾을 수 없습니다. 지워졌거나 볼 수 없는 견적입니다.',
  quoteNotContractable: '견적이 지금 작성 중이거나 거절 상태라 그 값으로 다시 채울 수 없습니다.',
  noSource: '견적 없이 만든 계약서라 다시 채울 견적이 없습니다.',
  note: (fromVersion: number, toVersion: number): string => `견적 버전 ${fromVersion}에서 ${withJosa(String(toVersion), euroRo)} 다시 채움`,
} as const

/** 계약서 종이와 내보내기 말 (P0132 I12) */
export const CONTRACT_PAPER = {
  name: '상호',
  address: '주소',
  ceo: '대표',
  dateBlank: '년      월      일',
  mark: { seal: '(인)', sign: '(서명)', either: '(서명 또는 인)' } as Record<'seal' | 'sign' | 'either', string>,
  footer: (contractNo: string, versionNo: number): string => `계약서 번호 ${contractNo} · 버전 ${versionNo}`,
  fileWord: '계약서',
  fileVersion: (n: number): string => `버전${n}`,
  badFormat: '내려받을 형식을 알 수 없습니다. PDF 나 Word 파일 중에서 골라 주세요.',
  renderFailed: 'PDF 를 만들지 못했습니다. 잠시 후 다시 시도하거나 Word 파일로 내려받아 주세요.',
} as const

/** 버전이 생긴 까닭 — 버전 기록에 이 말로 보인다 */
export const CONTRACT_VERSION_KIND: Record<string, string> = {
  /** 견적에서도 딜 없이도 첫 버전은 이것이다 — 「견적으로」라 쓰면 딜 없는 계약에 거짓이 된다 */
  GENERATED: '처음 만듦',
  EDITED: '손으로 고침',
  AI_EDIT: 'AI 지시로 고침',
  REFILLED: '견적으로 다시 채움',
  AMENDED: '변경 계약서로 만듦',
}

/** 템플릿 화면 말 */
export const CONTRACT_TEMPLATE = {
  cardTitle: '계약서 템플릿',
  cardDesc: '계약서를 만들 때 쓰는 조항 묶음입니다. 사업 유형마다 기본 템플릿을 하나 정하면 그 유형의 딜에서 먼저 골라집니다.',
  editTitle: '템플릿 고치기',
  /** 템플릿이 없어 막혔을 때 설정의 계약 탭으로 보내는 단추 */
  goCreate: '계약서 템플릿 만들기',
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
  /** 주민등록번호를 지운 자리의 이름표 — 그 뒤 칸이 생년월일이다 */
  birthLabel: '생년월일',
  scrubbed: (n: number): string => `주민등록번호 ${n}곳을 지우고 생년월일 칸으로 바꿨습니다. 주민등록번호는 저장하지 않습니다.`,
  leftover: (n: number, examples: string): string => `칸으로 못 바꾼 값 ${n}곳이 남았습니다: ${examples}. 「칸 넣기」로 바꿔 주세요.`,
  leftoverAt: (where: string, text: string): string => `${where} 「${text}」`,
  untitledClause: (n: number): string => `${n}번째 덩어리`,
  sourceFile: (name: string): string => `원본 파일: ${name}`,
  failed: '파일로 템플릿을 만들지 못했습니다.',
} as const

/**
 * 문서 머리줄 말 — 견적서와 계약서가 같은 자리에 같은 말을 쓴다 (P0132 I12a)
 *
 * 보냄은 상태가 아니라 체크다(DOC.sent). 머리줄은 상태 옆에 그 체크를 따로 세운다 —
 * 「작성 중인데 이미 보냄」이 계약서에서는 정상이라 둘을 한 배지로 합치면 하나가 안 보인다.
 */
export const DOC_HEADER = {
  notSent: '아직 안 보냄',
  sentVersion: (date: string, versionNo: number): string => `보냄 ${date} · ${versionLabel(versionNo)}`,
  current: (versionNo: number): string => `지금 ${versionLabel(versionNo)}`,
} as const

/** 변경 이력 패널 — 감사 기록을 읽기만 한다. 메뉴의 「변경 이력」과 같은 이름 */
export const DOC_HISTORY = {
  title: '변경 이력',
  empty: '아직 남은 기록이 없습니다',
  emptyNext: '고치거나 보내면 누가 언제 했는지 여기에 남습니다.',
  denied: '변경 이력을 볼 권한이 없습니다. 필요하면 관리자에게 요청해 주세요.',
  more: '더 보기',
} as const

/** 감사 기록의 계약서 동작 — 변경 이력에 이 문장으로 보인다 */
export const CONTRACT_AUDIT_LABEL: Record<string, string> = {
  'contract.created': '계약서를 만들었어요',
  'contract.meta_updated': '계약 정보를 고쳤어요',
  'contract.deviation_approved': '표준과 다른 조항을 승인했어요',
  'contract.version_saved': '계약서 새 버전을 남겼어요',
  'contract.refilled': '견적 값으로 계약서를 다시 채웠어요',
  'contract.amended': '변경 계약서를 만들었어요',
  'contract.send': '계약서를 보냄으로 표시했어요',
  'contract.conclude': '계약서를 체결했어요',
  'contract.terminate': '계약을 해지했어요',
  'contract.cancel': '계약서를 취소했어요',
  'contract.deleted': '계약서를 휴지통으로 보냈어요',
  'contract.purged': '계약서를 영구 삭제했어요',
  'contract.restored': '계약서를 되살렸어요',
}

/** 계약서 화면 말 (P0132 I12a) */
export const CONTRACT_SCREEN = {
  denied: '이 계약서를 볼 권한이 없습니다. 필요하면 관리자에게 요청해 주세요.',
  noClauses: '조항이 없는 계약서입니다',
  noClausesNext: '고치기에서 조항을 넣어 주세요.',
  conflictReloaded: '다른 사람이 먼저 고쳐 최신 내용을 다시 불러왔습니다. 확인한 뒤 다시 해 주세요.',
  parent: '원 계약서',
  paperTitle: (contractNo: string, versionNo: number): string => `${contractNo} ${versionLabel(versionNo)}`,

  preview: '미리보기 · 내보내기',
  exportPdf: 'PDF로 저장',
  exportDocx: 'Word로 저장',
  previewDenied: '이 계약서를 파일로 내보낼 권한이 없어 미리보기를 열 수 없습니다. 필요하면 관리자에게 요청해 주세요.',

  refill: '다시 채우기',
  refillTitle: '이 계약서를 만든 뒤 견적이 바뀌었습니다',
  refillBody: (from: number, to: number): string => `계약서는 견적 버전 ${from} 값으로 채웠고 견적은 지금 버전 ${to}입니다. 다시 채우면 아래 칸이 지금 견적 값으로 바뀌고 다음 버전이 됩니다.`,
  refillKept: '손으로 고친 칸이라 다시 채워도 남습니다',
  refillNone: '견적이 바뀌었지만 계약서에 들어간 값은 같습니다.',
  refillDone: (n: number): string => `견적 값으로 다시 채워 ${withJosa(versionLabel(n), eulReul)} 남겼습니다.`,

  send: '보냄으로 표시',
  sendTitle: (contractNo: string): string => `${contractNo} 계약서를 보냄으로 표시할까요?`,
  sendBody: (n: number): string => `지금 ${withJosa(versionLabel(n), eulReul)} 고객에게 낸 것으로 남깁니다. 보낸 뒤에도 작성 중이면 고칠 수 있고, 고치면 다음 버전이 됩니다.`,
  conclude: '체결',
  concludeTitle: (contractNo: string): string => `${contractNo} 계약서를 체결할까요?`,
  concludeBody: (n: number): string => `${withJosa(versionLabel(n), euroRo)} 체결합니다. 체결하면 글이 굳어 더 고칠 수 없고, 이 버전의 공급가가 딜의 계약 금액이 됩니다.`,
  pickSigned: '서명본',
  signedNone: '이 딜에 계약서 종류로 올린 파일이 아직 없습니다. 아래에서 서명본을 올린 뒤 골라 주세요.',
  signedRequired: '체결하려면 서명본을 골라 주세요.',
  signedLoadFailed: '서명본 목록을 불러오지 못했습니다.',
  terminate: '해지',
  terminateTitle: (contractNo: string): string => `${contractNo} 계약을 해지할까요?`,
  terminateBody: '해지하면 이 계약은 끝난 상태가 되고 되돌릴 수 없습니다. 딜 금액은 바뀌지 않습니다.',
  cancel: '계약서 취소',
  cancelTitle: (contractNo: string): string => `${contractNo} 계약서를 취소할까요?`,
  cancelBody: '작성 중인 이 계약서를 접습니다. 취소한 계약서는 고칠 수도 되살릴 수도 없습니다.',
  amend: '변경 계약서 만들기',
  amendTitle: (contractNo: string): string => `${contractNo} 에서 변경 계약서를 만들까요?`,
  amendBody: '이 계약은 체결 상태로 남고, 지금 버전의 조항과 손으로 넣은 칸을 이은 새 계약서를 새 번호로 만듭니다.',
  adminOnlyHint: '체결과 해지는 관리자가 합니다.',

  editTitle: '계약서 고치기',
  titleLabel: '계약서 제목',
  fieldsSection: '칸 값',
  clausesSection: '조항',
  fieldAuto: '견적 값',
  fieldManual: '손으로 넣음',
  fieldHint: '비우면 견적 값으로 돌아갑니다. 견적에서 오지 않는 칸은 비어 있으면 (미입력)으로 찍힙니다.',
  noteLabel: '고친 까닭',
  notePlaceholder: '예: 고객 요청으로 지급 기한 조정',
  noChange: '바뀐 것이 없어 새 버전을 만들지 않았습니다.',
  saved: (n: number): string => `${withJosa(versionLabel(n), eulReul)} 남겼습니다.`,

  aiTitle: 'AI로 고치기',
  aiInstruction: '무엇을 고칠까요',
  aiPlaceholder: '예: 대금 지급 기한을 30일로 바꿔 주세요',
  aiPropose: '제안 받기',
  aiProposeHint: 'AI 가 고칠 조각을 제안합니다. 고른 조각만 다음 버전으로 남고, 고르기 전에는 아무것도 저장되지 않습니다.',
  aiClause: (n: number): string => `조항 ${n}`,
  aiBefore: '지금',
  aiAfter: '바뀜',
  aiRejected: '반영할 수 없음',
  aiPick: (n: number): string => `이 조각 반영 (${n})`,
  aiApply: (n: number): string => `고른 ${n}개 반영`,
  aiNoUsable: '반영할 수 있는 조각이 없습니다. 지시를 바꿔 다시 제안받아 주세요.',

  versionsEmpty: '버전 기록이 없습니다',
  versionCurrent: '지금 버전',
  versionSent: '보낸 버전',
  versionConcluded: '체결한 버전',
  viewVersion: '이 버전 보기',
  compareA: '앞 버전',
  compareB: '뒤 버전',
  compareRun: '비교',
  compareSame: '두 버전의 조항과 칸 값이 같습니다.',
  compareClauses: '조항 차이',
  compareFields: '칸 값 차이',
  compareNeedsTwo: '버전이 둘 이상이어야 비교할 수 있습니다.',
  diffKind: { added: '새로 들어감', removed: '빠짐', changed: '고침', moved: '자리 옮김' } as Record<'added' | 'removed' | 'changed' | 'moved', string>,
} as const

/** 딜 화면의 계약서 카드 (P0132 I13) */
export const DEAL_CONTRACTS = {
  empty: '이 딜의 계약서가 아직 없습니다',
  emptyNext: '보냈거나 수락된 견적에서 「계약서 만들기」를 누르면 템플릿으로 채워 만듭니다.',
  denied: '계약서를 볼 권한이 없습니다. 필요하면 관리자에게 요청해 주세요.',
} as const

/** 견적에서 계약서 만들 때 템플릿 고르기 (P0132 I13) */
export const CONTRACT_CREATE = {
  pickTitle: '어느 템플릿으로 만들까요',
  pickHint: '고른 템플릿의 조항에 이 견적 값을 채워 첫 버전을 만듭니다.',
} as const

/** 계약서 목록 화면 (P0132 I15) */
export const CONTRACT_LIST = {
  description: '매출 매입 제휴 회사 단위 계약서를 한곳에서 봅니다. 딜 없이 만들거나 견적에서 만듭니다.',
  search: '계약서 번호·제목·딜로 검색',
  colContract: '계약서',
  colStatus: '상태',
  colSent: '보냄',
  colVersion: '버전',
  colAmount: '금액',
  emptyFiltered: '조건에 맞는 계약서가 없어요',
  emptyFilteredNext: '검색어나 상태를 바꿔 보세요.',
  empty: '아직 만든 계약서가 없어요',
  emptyNext: '「새 계약서」로 딜 없이 만들거나, 보냈거나 수락된 견적에서 「계약서 만들기」를 누르세요.',
  unit: '건',
  unknownName: '번호를 알 수 없는 계약서',
} as const

/** 계약서 지우기 창이 말하는 영향 (P0132 I15) */
export const CONTRACT_DELETE = {
  removed: ['이 계약서의 버전 기록'],
  kept: ['딜과 견적', '이미 내보낸 파일'],
} as const

/** 조항 라이브러리 (P0184 I05) */
export const CONTRACT_CLAUSE_MSG = {
  notFound: '조항을 찾을 수 없습니다.',
  badKey: '조항 키는 영문 소문자, 숫자, 점, 밑줄, 줄표로 64자까지입니다.',
  badLang: '조항 언어는 한국어(ko) 또는 영어(en)입니다.',
  titleRequired: '조항 제목을 넣어 주세요.',
  bodyRequired: '조항 본문을 넣어 주세요.',
  keyTaken: '같은 키의 조항이 이미 있습니다. 그 조항을 고쳐 다음 버전으로 만드세요.',
  draftExists: '이 조항은 이미 고치는 중인 초안이 있습니다. 그 초안을 고쳐 주세요.',
  conflict: '다른 사람이 이 조항을 먼저 고쳤습니다. 새로고침 후 다시 시도해 주세요.',
  notDraft: '초안만 승인하거나 지울 수 있습니다. 승인된 조항은 고치면 다음 버전 초안이 됩니다.',
  approveDenied: '조항 승인은 관리자만 할 수 있습니다.',
} as const

export const CONTRACT_CLAUSE_STATUS = { DRAFT: '초안', APPROVED: '승인' } as const

/** 설정 계약 탭의 조항 라이브러리 카드 (P0184 I05) */
export const CONTRACT_CLAUSE_CARD = {
  cardTitle: '조항 라이브러리',
  cardDesc: '계약서를 조립하는 표준 조항입니다. 승인한 조항이 표준이 되고, 승인한 글을 고치면 다음 버전 초안이 새로 생깁니다.',
  create: '새 조항',
  editTitle: '조항 수정',
  key: '조항 키',
  keyPlaceholder: '예: common.confidentiality',
  keyHelp: '같은 조항의 버전을 묶는 이름입니다. 만든 뒤에는 바꿀 수 없습니다.',
  lang: '언어',
  langLabel: { ko: '한국어', en: '영어' } as Record<'ko' | 'en', string>,
  title: '조항 제목',
  titlePlaceholder: '예: 제5조 (비밀유지)',
  body: '조항 본문',
  version: (n: number): string => `버전 ${n}`,
  approve: '승인',
  approveTitle: (key: string, n: number): string => `「${key}」 버전 ${n}, 승인할까요?`,
  approveBody: '승인한 글은 표준이 되어 고칠 수 없습니다. 고치려면 다음 버전 초안을 만듭니다.',
  forkNote: '승인한 조항이라 고치면 다음 버전 초안으로 저장됩니다.',
  forked: (n: number): string => `버전 ${n} 초안으로 저장했습니다. 승인한 글은 그대로입니다.`,
  deleteTitle: (key: string, n: number): string => `「${key}」 버전 ${n} 초안을 삭제할까요?`,
  deleteBody: '초안만 삭제합니다. 승인한 버전은 남습니다.',
  loadFailed: '조항을 불러오지 못했습니다.',
  saveFailed: '조항을 저장하지 못했습니다.',
  approveFailed: '조항을 승인하지 못했습니다.',
  deleteFailed: '조항을 삭제하지 못했습니다.',
  empty: '조항이 아직 없어요',
  emptyNext: '표준 조항을 만들고 관리자가 승인하면 계약서 조립에 쓰입니다.',
} as const

/** 계약 모듈과 조립 (P0184 I06) */
export const CONTRACT_MODULE_MSG = {
  badKind: '모듈 종류가 올바르지 않습니다.',
  badCondition: '켜는 조건의 모양이 올바르지 않습니다.',
  badConditionField: (field: string): string => `켜는 조건에 쓸 수 없는 칸입니다: ${field}`,
  tooManyRules: (max: number): string => `켜는 조건은 ${max}줄까지입니다.`,
  missingClauses: (keys: string): string => `승인된 조항이 없어 조립하지 못했습니다: ${keys}`,
  notFound: '모듈을 찾을 수 없습니다.',
  badKey: '모듈 키는 영문 소문자, 숫자, 점, 밑줄, 줄표로 64자까지입니다.',
  keyTaken: '같은 키의 모듈이 이미 있습니다.',
  titleRequired: '모듈 이름을 120자 안으로 넣어 주세요.',
  badClauseKeys: '조항 키 목록이 올바르지 않습니다. 같은 키를 두 번 넣지 말고 60개까지 넣어 주세요.',
  unknownClauses: (keys: string): string => `조항 라이브러리에 없는 키입니다: ${keys}`,
  badPosition: '순서는 0부터 9999까지의 정수입니다.',
  conflict: '다른 사람이 이 모듈을 먼저 고쳤습니다. 새로고침 후 다시 시도해 주세요.',
  editDenied: '계약 모듈은 관리자만 만들고 고칠 수 있습니다.',
} as const

/** 계약에 모듈을 골라 조립 (P0184 I12) */
export const CONTRACT_ASSEMBLY_MSG = {
  badModuleKeys: '고른 모듈 목록이 올바르지 않습니다.',
  unknownModules: (keys: string): string => `없거나 꺼진 모듈입니다: ${keys}`,
  nothingToAssemble: '들어갈 모듈이 없습니다. 설정의 계약 탭에서 모듈을 만들고 조항을 넣어 주세요.',
  versionNote: (titles: string): string => `모듈 조립: ${titles}`,
} as const

export const CONTRACT_ASSEMBLY = {
  open: '모듈로 조립',
  title: '모듈 골라 조립',
  intro: '공통 조항 위에 고른 모듈을 얹어 본문을 새로 만듭니다. 지금 본문은 버전 기록에 남습니다.',
  noModules: '만든 모듈이 없습니다. 설정의 계약 탭에서 모듈을 만들어 주세요.',
  goModules: '모듈 만들러 가기',
  common: '공통 조항 (늘 들어감)',
  automatic: '조건이 맞아 저절로 들어감',
  willInclude: (n: number): string => `조항 ${n}개로 조립합니다.`,
  missing: (keys: string): string => `승인된 조항이 없어 조립할 수 없습니다: ${keys}. 설정의 조항 라이브러리에서 승인해 주세요.`,
  checking: '조립할 조항을 세는 중입니다',
  assemble: '조립',
  done: (n: number): string => `모듈로 조립했습니다 (버전 ${n}).`,
  failed: '모듈로 조립하지 못했습니다.',
} as const

/** 설정 계약 탭의 계약 모듈 카드 (P0184 I11) */
export const CONTRACT_MODULE_CARD = {
  cardTitle: '계약 모듈',
  cardDesc: '공통 조항 위에 얹는 조항 묶음입니다. 계약에서 고르거나, 켜는 조건이 맞으면 저절로 들어갑니다.',
  adminOnly: '모듈은 관리자만 만들고 고칠 수 있습니다.',
  create: '새 모듈',
  editTitle: '모듈 수정',
  key: '모듈 키',
  keyPlaceholder: '예: perf.gpu-rental',
  keyHelp: '계약이 이 모듈을 가리키는 이름입니다. 만든 뒤에는 바꿀 수 없습니다.',
  kind: '종류',
  title: '모듈 이름',
  titlePlaceholder: '예: GPU 임대',
  clauses: '넣을 조항',
  clauseNoun: '조항',
  addClause: '조항 추가',
  clausesHelp: '고른 순서대로 계약서에 들어갑니다. 승인된 조항만 조립됩니다.',
  noClauses: '조항 라이브러리에 조항이 없습니다. 조항을 먼저 만들어 주세요.',
  clauseCount: (n: number): string => `조항 ${n}개`,
  moveUp: '위로',
  moveDown: '아래로',
  condition: '켜는 조건',
  conditionNone: '조건 없음 (계약에서 고를 때만)',
  conditionHelp: '모든 줄이 맞으면 고르지 않아도 들어갑니다. 규제 모듈은 조건이 맞을 때만 들어갑니다.',
  addRule: '조건 줄 추가',
  removeRule: '조건 줄 삭제',
  field: { direction: '계약 방향', businessTypeKey: '사업 유형', value: '계약 칸 값' } as Record<'direction' | 'businessTypeKey' | 'value', string>,
  valueKey: '칸 키',
  valueKeyPlaceholder: '예: contract.amount',
  op: { in: '다음 중 하나', notIn: '다음이 아님', truthy: '값이 있음' } as Record<'in' | 'notIn' | 'truthy', string>,
  values: '값',
  valuesPlaceholder: '쉼표로 나눔, 예: SALES, PURCHASE',
  ruleSummary: (n: number): string => `조건 ${n}줄`,
  active: '사용',
  inactive: '꺼짐',
  position: '순서',
  deleteTitle: (key: string): string => `「${key}」 모듈을 삭제할까요?`,
  deleteBody: '모듈만 삭제하고 조항은 라이브러리에 남습니다. 이 모듈을 고른 계약은 다음 조립 때 이 묶음이 빠집니다.',
  empty: '아직 모듈이 없습니다',
  emptyNext: '관리자가 조항을 묶어 모듈을 만들면 계약에서 고를 수 있습니다.',
  loadFailed: '모듈을 불러오지 못했습니다.',
  saveFailed: '모듈을 저장하지 못했습니다.',
  deleteFailed: '모듈을 삭제하지 못했습니다.',
} as const

/** 모듈 종류 이름 */
export const CONTRACT_MODULE_KIND = {
  COMMON: '공통 조항',
  PERFORMANCE: '급부',
  CONSIDERATION: '대가',
  REGULATION: '규제',
  ANNEX: '부속서',
} as const

/** 조립한 조항의 제목 모양 */
export const assembledArticleTitle = (n: number, title: string): string => `제${n}조 (${title})`
export const assembledAnnexTitle = (n: number, title: string): string => `부속서 ${n}. ${title}`

/** 지급 일정 (P0184 I07) */
export const CONTRACT_PAYMENT = {
  kind: {
    LUMP: '일시 지급', INSTALLMENT: '분할 지급', FIXED: '정액 정기 지급', USAGE: '사용량 정산', PREPAID: '선불',
    COMMITMENT: '약정', COMMISSION: '수수료', POINT_CONVERSION: '포인트 전환', SUBSIDY: '보조금',
  } as Record<'LUMP' | 'INSTALLMENT' | 'FIXED' | 'USAGE' | 'PREPAID' | 'COMMITMENT' | 'COMMISSION' | 'POINT_CONVERSION' | 'SUBSIDY', string>,
  period: { MONTH: '매월', QUARTER: '분기마다', YEAR: '매년' } as Record<'MONTH' | 'QUARTER' | 'YEAR', string>,
  colKind: '대가', colStage: '구분', colPercent: '비율', colAmount: '금액', colDue: '지급 시기', colPeriod: '주기',
  colUnitPrice: '단가', colMinimum: '최소 금액', colExpiry: '사용 기한', colRefund: '남은 금액 처리',
  colShortfall: '약정 미달 시', colBasis: '기준', colPoints: '포인트', colSettlement: '정산',
  colSubsidy: '보조금', colOwnShare: '자부담', colAgency: '지원 기관',
  total: '합계',
  none: '없음',
  percent: (n: number): string => `${n}%`,
  dueDay: (d: number): string => `${d}일`,
  months: (n: number): string => `${n}개월`,
  points: (n: number): string => `${n.toLocaleString('ko-KR')}점`,
} as const

export const CONTRACT_PAYMENT_MSG = {
  badKind: '대가 종류가 올바르지 않습니다.',
  badShape: '지급 일정의 모양이 올바르지 않습니다.',
  badAmount: '금액은 최소 단위의 정수로 넣어 주세요.',
  badCurrency: '통화는 세 글자 코드로 넣어 주세요.',
  badPercent: '비율은 소수 둘째 자리까지 넣을 수 있습니다.',
  percentSum: (sum: number): string => `분할 비율의 합이 100%가 아닙니다 (지금 ${sum}%).`,
} as const

/** 표준 이탈과 관리자 승인 (P0184 I08) */
export const CONTRACT_DEVIATION_MSG = {
  needsApproval: (n: number): string => `표준과 다른 조항이 ${n}개 있어 관리자 승인 전에는 체결할 수 없습니다.`,
  approveDenied: '표준 이탈 승인은 관리자만 할 수 있습니다.',
  noDeviations: '표준과 다른 조항이 없어 승인할 것이 없습니다.',
  alreadyApproved: '이 버전은 이미 승인했습니다.',
  notDraft: '체결 전 계약서만 승인할 수 있습니다.',
  reason: { ai: 'AI 가 쓴 조항', manual: '새로 넣은 조항', changed: '표준과 다른 글', removed: '빠진 표준 조항', unknown: '표준에 없는 조항' } as Record<'ai' | 'manual' | 'changed' | 'removed' | 'unknown', string>,
} as const

/** 계약의 성격 이름 (P0184 I10) — 목록 필터와 만들기 창이 같은 말을 쓴다 */
export const CONTRACT_KIND_LABEL = {
  direction: {
    SALES: '매출', PURCHASE: '매입', PARTNERSHIP: '제휴', CONSORTIUM: '공동수급', BROKERAGE: '3자', CORPORATE: '회사 단위',
  } as Record<'SALES' | 'PURCHASE' | 'PARTNERSHIP' | 'CONSORTIUM' | 'BROKERAGE' | 'CORPORATE', string>,
  formOwner: { OURS: '우리 양식', THEIRS: '상대 양식', ISSUER: '발주처 양식' } as Record<'OURS' | 'THEIRS' | 'ISSUER', string>,
  docLayer: {
    STANDALONE: '단독 계약', MASTER: '기본계약', ORDER: '개별계약', AMENDMENT: '변경계약', MOU: '업무협약', NDA: '비밀유지',
  } as Record<'STANDALONE' | 'MASTER' | 'ORDER' | 'AMENDMENT' | 'MOU' | 'NDA', string>,
  sensitivity: { SALES: '영업', PURCHASE: '매입', CORPORATE: '회사 기밀' } as Record<'SALES' | 'PURCHASE' | 'CORPORATE', string>,
  partyRole: {
    SUPPLIER: '공급자', CUSTOMER: '고객', LEAD: '주관사', MEMBER: '구성원', BROKER: '중개자', PARTNER: '제휴사', OTHER: '기타',
  } as Record<'SUPPLIER' | 'CUSTOMER' | 'LEAD' | 'MEMBER' | 'BROKER' | 'PARTNER' | 'OTHER', string>,
  colDirection: '방향',
  colFormOwner: '양식',
  colSensitivity: '등급',
} as const

/** 딜 없이 계약서 만들기 창 (P0184 I10) */
export const CONTRACT_CREATE_BLANK = {
  open: '새 계약서',
  title: '새 계약서',
  direction: '계약 방향',
  docLayer: '계약서 종류',
  formOwner: '양식',
  name: '계약서 제목',
  namePlaceholder: '예: GPU 서버 매입 계약',
  template: '템플릿',
  templateDefault: '기본 템플릿 (없으면 승인된 모듈로 조립)',
  noTemplate: '발행한 템플릿이 없어 승인된 공통 조항과 조건이 맞는 모듈로 첫 본문을 조립합니다.',
  goTemplates: '템플릿 발행하러 가기',
  parties: '당사자',
  partyRole: '역할',
  partyName: '상호',
  partyBizNo: '사업자번호',
  partySelf: '우리 회사',
  addParty: '당사자 넣기',
  removeParty: (n: number): string => `${n}번째 당사자 빼기`,
  partyHint: '매출은 상대가 고객, 매입은 상대가 공급자입니다. 공동수급은 주관사 한 곳과 구성원을 넣습니다.',
  corporateHint: '회사 단위 계약은 관리자만 보고 만들 수 있습니다.',
  saveFailed: '계약서를 만들지 못했습니다.',
} as const

/** 계약 정보 고치기 (P0184 I10) — 만들 때 고른 방향 양식 종류 제목 당사자 */
export const CONTRACT_META = {
  open: '계약 정보',
  title: '계약 정보 고치기',
  partiesFollowQuote: '견적에서 만든 계약서의 당사자는 견적을 따릅니다. 견적을 고친 뒤 다시 채우기를 써 주세요.',
  notDraft: '체결 전 계약서만 고칠 수 있습니다.',
  saved: '계약 정보를 고쳤습니다.',
  saveFailed: '계약 정보를 고치지 못했습니다.',
} as const
