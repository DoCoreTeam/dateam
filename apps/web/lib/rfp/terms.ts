/**
 * RFP 분석기의 말 — 화면이 여는 한 곳 (용어집 §01 2층, 설계서 6장 문체 규약)
 *
 * ## 왜 여기 모으나
 *
 * 이 저장소는 같은 개체를 화면마다 다르게 부른 전례가 있다 —
 * 「담당자」와 「인물」, 「영업기회」와 「딜」. 그때마다 사용자는 **다른 것**으로 읽었다.
 * RFP 는 등급·단계·판정처럼 뜻이 갈리면 곧장 위험해지는 말이 많다.
 * 그래서 화면(`app/(rfp)/**`·`components/rfp/**`)은 한글을 직접 적지 않고 여기서 가져간다.
 *
 * ## 여기 없는 것
 *
 * **판정 규칙은 여기 없다** — 무엇이 허용되는지는 `domain/doc-class.ts`,
 * 어디로 갈 수 있는지는 `domain/status.ts` 다. 이 파일은 «그것을 뭐라 부르나»만 안다.
 *
 * ## 문체
 *
 * 설계서 6장: 개조식, 마침표 없는 종결, 이모지 미사용
 */

import type { DocClass } from './domain/doc-class.ts'
import type { Stage } from './domain/status.ts'

/** 서비스 간판 */
export const RFP_SERVICE_LABEL = 'RFP 분석기'

/** 문서 등급 — 사용자가 인입 때 고르는 세 값 */
export const DOC_CLASS_LABEL: Record<DocClass, string> = {
  public: '공개',
  restricted: '조건부 공개',
  nda: '민간 NDA',
}

/** 등급을 왜 고르는지 — 고르는 자리에 함께 보인다 */
export const DOC_CLASS_HINT: Record<DocClass, string> = {
  public: '나라장터 공고 첨부처럼 이미 공개된 문서',
  restricted: '입찰참가 등록자에게만 배포되거나 대외비 표기가 있는 문서',
  nda: '비밀유지계약 아래 받은 민간 문서',
}

/** 등급이 실제로 무엇을 막는지 — 고르고 나서 결과를 짐작하지 않게 */
export const DOC_CLASS_EFFECT: Record<DocClass, string> = {
  public: '승인된 모든 벤더로 분석 가능',
  restricted: '학습 미사용과 무보존 계약 벤더만 사용',
  nda: '외부 전송 차단, 내부 모델 또는 관리자 승인 필요',
}

/** 단계 이름 — 진행률 표시에 그대로 나간다 */
export const STAGE_LABEL: Record<Stage, string> = {
  uploaded: '올림',
  classified: '역할 분류',
  parsing: '읽는 중',
  parsed: '읽음',
  structuring: '구조 잡는 중',
  structured: '구조 잡음',
  indexing: '색인 만드는 중',
  indexed: '색인 만듦',
  analyzing: '분석 중',
  reported: '리포트 나옴',
  cross_verifying: '교차검증 중',
  assessing: '적합도 보는 중',
  assessed: '적합도 나옴',
  comparing: '비교 중',
  compared: '비교 나옴',
}

/** 파일 역할 9종 — RFP 는 파일 하나가 아니라 묶음이다(설계서 5장 2) */
export type FileRole =
  | 'main' | 'scope' | 'notice' | 'special_terms' | 'proposal_guide'
  | 'forms' | 'qna' | 'amendment' | 'etc'

export const FILE_ROLE_LABEL: Record<FileRole, string> = {
  main: '제안요청서 본문',
  scope: '과업내용서',
  notice: '입찰공고문',
  special_terms: '계약특수조건',
  proposal_guide: '제안서 작성 안내',
  forms: '서식',
  qna: '질의응답 답변',
  amendment: '정정공고',
  etc: '기타',
}

/** 값이 얼마나 검증됐나 — 리포트 항목마다 붙는 배지 */
export type Verification = 'single' | 'agreed' | 'majority' | 'conflict' | 'user_fixed'

export const VERIFICATION_LABEL: Record<Verification, string> = {
  single: '단일',
  agreed: '일치',
  majority: '다수 일치',
  conflict: '불일치',
  user_fixed: '사용자 확정',
}

/** 근거가 원문에서 확인됐나 — 확인 못 한 값은 확정으로 읽히면 안 된다 */
export type Grounding = 'confirmed' | 'unconfirmed'

export const GROUNDING_LABEL: Record<Grounding, string> = {
  confirmed: '근거 확인',
  unconfirmed: '근거 미확인',
}

export const GROUNDING_HINT: Record<Grounding, string> = {
  confirmed: '인용한 문장이 원문에서 그대로 확인됨',
  unconfirmed: '원문에서 찾지 못함, 사람이 확인 필요',
}

/** 이상 조항 등급 — 규칙이 잡은 것과 AI 가 의심한 것을 섞지 않는다 */
export type AnomalyGrade = 'confirmed' | 'suspect' | 'dismissed'

export const ANOMALY_GRADE_LABEL: Record<AnomalyGrade, string> = {
  confirmed: '확정',
  suspect: '의심',
  dismissed: '기각',
}

/** 이상 조항 심각도 4단계(설계서 3.8.5) */
export type AnomalySeverity = 'blocking' | 'margin' | 'contract' | 'competition'

export const ANOMALY_SEVERITY_LABEL: Record<AnomalySeverity, string> = {
  blocking: '참여 불가 수준',
  margin: '수익성 위협',
  contract: '계약 리스크',
  competition: '경쟁 제한 의심',
}

/** 적합도 판정 3분기 */
export type FitVerdict = 'full' | 'partial' | 'unfit'

export const FIT_VERDICT_LABEL: Record<FitVerdict, string> = {
  full: '전체 수행 가능',
  partial: '부분 참여 적합',
  unfit: '부적합',
}

/** 요건별 결과 — 「확인 불가」를 「미충족」으로 접지 않는다 */
export type RequirementResult = 'met' | 'unmet' | 'unknown'

export const REQUIREMENT_RESULT_LABEL: Record<RequirementResult, string> = {
  met: '충족',
  unmet: '미충족',
  unknown: '확인 불가',
}

/** 분석 모드 3종 */
export type AnalysisMode = 'base' | 'cross_pre' | 'cross_post'

export const ANALYSIS_MODE_LABEL: Record<AnalysisMode, string> = {
  base: '기본',
  cross_pre: '교차검증',
  cross_post: '항목별 교차검증',
}

/**
 * AI 생성 고지 — 리포트·어시스턴트·내보내기 파일에 **전부** 들어간다.
 *
 * 설계서 2.7.1: AI 기본법 투명성 확보 의무 대상이 될 수 있어 처음부터 붙인다.
 * 계도기간을 이유로 미루면 나중에 「어디에 붙였더라」를 다시 훑어야 한다.
 */
export const AI_NOTICE = 'AI 생성 결과, 검토 필요'

/** 파싱 품질이 낮을 때 — 결과를 믿기 전에 사람이 알아야 한다 */
export const LOW_QUALITY_WARNING = '파싱 품질 낮음, 결과 신뢰도 제한'

/** 배포용 HWP 는 열 수 없다 — 우회하지 않고 안내한다(설계서 4장 1) */
export const DRM_HWP_GUIDE = '배포용 문서라 열 수 없음, 한글에서 PDF 로 저장한 뒤 올려 주세요'

/** 교차검증 권장 배지 */
export const CROSS_RECOMMEND_LABEL = '교차검증 권장'

/** 비용과 시간 예측은 언제나 오차 범위를 함께 말한다(설계서 4장 7) */
export function estimateLine(krw: number, minutes: number): string {
  return `약 ${krw.toLocaleString('ko-KR')}원, 약 ${minutes}분 (±30%)`
}

// ── 화면의 말 ────────────────────────────────────────────────
//
// 화면은 한글을 직접 적지 않는다(가드: lib/rfp/domain/domain.test.ts).
// 같은 것을 두 화면이 다르게 부르면 사용자는 두 기능인 줄 안다.

/** 메뉴와 화면 제목 */
export const RFP_NAV = {
  cases: '케이스',
  newCase: '새 분석',
  radar: '공고 레이더',
  profile: '회사 프로필',
  assistant: '어시스턴트',
  admin: '설정',
} as const

/** 목록 화면 */
export const RFP_LIST = {
  title: '분석 케이스',
  searchPlaceholder: '사업명으로 검색',
  emptyTitle: '아직 분석한 공고가 없어요',
  emptyDesc: '제안요청서를 올리면 파싱과 구조화를 거쳐 리포트를 만듭니다',
  emptyAction: '공고 올리기',
  emptySearchTitle: '조건에 맞는 케이스가 없어요',
  emptySearchDesc: '검색어를 바꿔 보세요',
  colTitle: '사업명',
  colStage: '진행',
  colDocClass: '등급',
  colBudget: '사업 금액',
  colDeadline: '제안 마감',
  colCreated: '올린 날',
  loadFailed: '목록을 불러오지 못했어요',
  retry: '다시 시도',
  limitNotice: '최근 것부터 보여 주고 있어요. 더 있으면 사업명을 검색해 주세요',
} as const

/** 인입 화면 */
export const RFP_INTAKE = {
  title: '공고 올리기',
  subtitle: '한글·PDF·오피스 문서를 그대로 올리면 됩니다',
  docClassLabel: '문서 등급',
  docClassRequired: '문서 등급을 골라 주세요',
  fileLabel: '첨부 파일',
  fileHint: '제안요청서·과업내용서·공고문·서식을 함께 올리면 한 케이스로 묶습니다',
  dropHere: '여기에 끌어다 놓거나',
  filePick: '파일 고르기',
  removeFile: '뺀다',
  docClassWhy: '등급이 어느 AI 까지 이 문서를 볼 수 있는지 정합니다. 고르지 않으면 시작할 수 없습니다',
  titleFromDoc: '사업명은 공고문에서 읽습니다. 따로 적지 않아도 됩니다',
  fileNone: '아직 고른 파일이 없어요',
  fileTooLarge: '파일 하나는 200MB 까지예요',
  caseQuota: '한 케이스에 500MB 까지 올릴 수 있어요',
  duplicate: '같은 내용의 파일이 이미 있어요',
  submit: '분석 시작',
  submitting: '올리는 중',
  uploaded: '올렸어요',
  failed: '올리지 못했어요',
  noticeNoLabel: '공고번호',
  noticeNoHint: '적으면 나라장터에서 공고 정보를 함께 가져옵니다',
  fetchNotice: '공고 가져오기',
  goReport: '리포트 보기',
} as const

/** 리포트 화면 */
export const RFP_REPORT = {
  viewWork: '작업용',
  viewReport: '보고용',
  evidence: '근거',
  noEvidence: '근거 미확인',
  openSource: '원문에서 보기',
  crossVerify: '교차검증',
  editValue: '값 고치기',
  anomalies: '이상 조항',
  fit: '적합도',
  comparisons: '유사 사업',
  noValue: '확인 못 함',
  exportMd: '마크다운으로 내보내기',
  exportHtml: '인쇄용으로 내보내기',
  sectionOverview: '사업 개요',
  sectionScope: '과업 범위',
  sectionSchedule: '일정',
  sectionBudget: '사업 금액',
  sectionConstraints: '제약과 자격',
  sectionChecklist: '제출 서류',
  sectionEvaluation: '평가 기준',
  notReady: '아직 리포트가 없어요',
  notReadyDesc: '분석이 끝나면 여기에 나타납니다',
} as const

/** 교차검증 대화 */
export const RFP_CROSS = {
  title: '교차검증',
  desc: '고른 항목만 다른 모델에 다시 물어 값을 맞춰 봅니다',
  pickFields: '검증할 항목',
  pickVendors: '쓸 모델',
  estimate: '예상',
  confirm: '검증 시작',
  cancel: '그만두기',
  conflict: '값이 갈렸어요',
  chooseFinal: '쓸 값 고르기',
  noBase: '기본 분석이 끝난 뒤에 쓸 수 있어요',
} as const

/** 프로필과 적합도 */
export const RFP_PROFILE = {
  title: '회사 프로필',
  desc: '적합도 판정이 이 정보를 씁니다',
  draftTitle: '문서로 채우기',
  draftUpload: '회사소개서 올리기',
  draftHint: '회사소개서·사업자등록증·실적표를 올리면 대부분 채워집니다',
  confirm: '확인하고 저장',
  companyName: '회사 이름',
  businessNumber: '사업자등록번호',
  capital: '자본금',
  revenue: '연간 매출',
  headcount: '임직원 수',
  region: '소재지',
  basicTitle: '회사 기본정보',
  basicDesc: '공고의 참가 자격과 대조합니다',
  certifications: '보유 인증',
  certificationsDesc: '공고가 요구하는 인증과 대조합니다',
  certName: '인증 이름',
  certIssuer: '발급 기관',
  certValidUntil: '유효 기한',
  trackRecords: '수행 실적',
  trackRecordsDesc: '실적 요건(건수·금액·기간)을 이걸로 판정합니다',
  recordName: '사업명',
  recordClient: '발주처',
  recordAmount: '계약 금액',
  recordStart: '시작',
  recordEnd: '종료',
  recordTags: '분야',
  capabilities: '보유 기술',
  capabilitiesDesc: '과업 내용과 맞춰 봅니다',
  capTag: '기술',
  capLevel: '숙련도',
  partners: '협력사',
  partnersDesc: '혼자 못 맞추는 요건을 누구와 맞출지 봅니다',
  partnerName: '협력사 이름',
  partnerCapabilities: '맡을 부분',
  addRow: '줄 추가',
  removeRow: '이 줄 빼기',
  emptyRows: '아직 없습니다',
  missing: '아직 못 채운 칸',
  missingHint: '이걸 채우기 전에는 적합도가 얕게 나옵니다',
  saveDraft: '초안으로 두기',
  /** missingForAssessment 가 돌려주는 이름 → 사람이 읽는 말 */
  missingLabel: {
    companyName: '회사 이름',
    trackRecords: '수행 실적',
    certifications: '보유 인증',
    headcount: '임직원 수',
  } as Record<string, string>,
  fitTitle: '적합도 판정',
  fitScore: '점수',
  fitConditional: '조건부',
  hardChecks: '자격 요건',
  gaps: '채워야 할 것',
  recommendedRole: '권장 역할',
  proposalOutline: '제안서 목차',
  proposalStrategy: '제안 전략',
  uncovered: '목차에 안 들어간 요구사항',
} as const

/** 레이더와 결과 */
export const RFP_RADAR = {
  title: '공고 레이더',
  desc: '규칙에 맞는 새 공고를 찾아 둡니다. 케이스로 만드는 것은 직접 고릅니다',
  rules: '찾을 조건',
  addRule: '조건 추가',
  ruleName: '조건 이름',
  keywords: '키워드',
  budgetRange: '예산 범위',
  agencies: '기관',
  sweepNow: '지금 찾아보기',
  hits: '찾은 공고',
  score: '사전 점수',
  reason: '걸린 이유',
  openCase: '케이스로 만들기',
  dismiss: '치우기',
  emptyTitle: '아직 찾은 공고가 없어요',
  emptyDesc: '조건을 만들고 «지금 찾아보기»를 눌러 보세요',
  outcomeTitle: '결과 기록',
  decision: '참여 결정',
  submitted: '제출 여부',
  result: '낙찰 결과',
  awardedTo: '낙찰 업체',
  awardedAmount: '낙찰 금액',
  ourRank: '우리 순위',
  save: '저장',
  revisionTitle: '정정공고 비교',
  revisionNone: '아직 정정공고가 없어요',
} as const

/** 관리자 설정 */
export const RFP_ADMIN = {
  title: '설정',
  vendors: 'AI 공급자',
  /** 키는 관리자 설정 한 곳에 있다 — 여기서 또 받지 않는다 */
  vendorsHint: 'AI 키와 모델은 관리자 설정 한 곳에서 관리합니다. 여기서는 어느 문서 등급까지 보낼지만 정합니다',
  vendorsLink: '관리자 설정에서 공급자 관리',
  vendorModel: '모델',
  internalVendor: '사내 서빙',
  internalHint: '사내에서 직접 서빙하는 모델은 등급 높은 문서도 처리할 수 있습니다',
  notRegistered: '키가 없어 못 씁니다',
  docClassAllowed: '보낼 수 있는 등급',
  noVendors: '쓸 수 있는 AI 공급자가 없어요',
  noVendorsHint: '관리자 설정에서 키를 넣으면 여기에 나타납니다',
  usagePeriod: '이번 달',
  usageCost: '쓴 비용',
  usageLimit: '한도',
  usageMembers: '구성원',
  unitKrw: '원',
  unitPeople: '명',
  unitCount: '건',
  rules: '이상 조항 규칙',
  ruleEnabled: '켜기',
  transferLog: '외부 전송 기록',
  usage: '사용량',
  monthlyBudget: '월 예산 상한',
  plan: '요금제',
  members: '구성원',
  invite: '초대',
  inviteEmail: '이메일',
  inviteRole: '역할',
  adminOnly: '관리자만 볼 수 있어요',
  saved: '저장했어요',
  saveFailed: '저장하지 못했어요',
} as const

/** 어시스턴트 */
export const RFP_ASSISTANT = {
  title: '어시스턴트',
  open: '어시스턴트 열기',
  ask: '질문',
  placeholder: '무엇이든 물어보세요',
  send: '묻기',
  thinking: '찾는 중',
  citations: '근거',
  relatedCases: '관련 케이스',
  noAnswer: '자료에서 찾지 못했어요',
  droppedForClass: '등급 때문에 뺀 문서가 있어요',
  examplesLead: '이렇게 물어보세요',
  examples: [
    '이번 공고의 참여 자격이 뭐야',
    '우리가 못 맞추는 요건이 있어',
    '경쟁 제한이 의심되는 조항 알려줘',
  ],
} as const

/** 도움말 — 내용은 lib/rfp/guide 가 갖고 여기는 껍데기 말만 */
export const RFP_HELP = {
  title: '사용법',
  short: '도움말',
  open: '이 화면 사용법 보기',
  flowTitle: '처음 쓴다면',
  flowLead: '한 번만 이 순서로 따라가면 됩니다',
} as const

/** 역할 이름 */
export const ORG_ROLE_LABEL: Record<'admin' | 'member' | 'viewer', string> = {
  admin: '관리자',
  member: '구성원',
  viewer: '보기 전용',
}

/** 공통 버튼과 상태 */
export const RFP_COMMON = {
  loading: '불러오는 중',
  error: '문제가 생겼어요',
  retry: '다시 시도',
  cancel: '취소',
  save: '저장',
  close: '닫기',
  back: '뒤로',
  none: '없음',
  yes: '예',
  no: '아니오',
} as const
