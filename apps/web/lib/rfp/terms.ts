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
