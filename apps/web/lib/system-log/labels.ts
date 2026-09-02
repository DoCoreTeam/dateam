// lib/system-log/labels.ts — 기능 이름을 **사용자가 부르는 말**로 (SSOT)
//
// 왜 여기로 승격했나: 같은 표가 `app/api/admin/ai-usage/logs/route.ts` 안에만 있었다.
// 시스템 로그도 같은 이름을 써야 하는데, 두 곳에 적으면 언젠가 한쪽만 늘어나고
// **같은 기능이 화면마다 다른 이름으로 불린다**(§2-5 용어 고정).
//
// 규칙: 코드 이름(`enrich-web`)이 아니라 **관리자가 화면에서 보는 말**을 적는다.
// 없는 키는 코드 이름 그대로 보여 준다 — 지어내지 않는다.

export const FEATURE_LABELS: Record<string, string> = {
  'weekly-report-refine': '주간보고 AI 정비',
  'report-preview-merge': '주간보고 병합 프리뷰',
  'report-export': '주간보고 내보내기',
  'lead-parse': '리드 인테이크 파싱',
  'account-fit-score': '거래처 적합도 점수',
  'deal-activity-parse': '딜 활동 AI 요약',
  'content-ai-edit': '콘텐츠 AI 편집',
  // CRM
  'enrich-web': '회사 정보 AI 보강',
  'crm-extract': 'CRM 정보 추출',
  'crm-api': 'CRM 화면·API',
  'quick-create': '붙여넣기로 등록',
  // 콘텐츠 인텔리전스
  'ci-collect': '콘텐츠 수집',
  'ci-analyze': '콘텐츠 분석',
  // 등록하지 않으면 화면에 «ci.signals이(가) 실패했습니다»처럼 내부 이름이 그대로 나온다(§0-2)
  'ci.signals': 'AI 이슈 수집',
  'ci-signals': 'AI 이슈 수집',
  'ci.assistant': 'CI 어시스턴트',
  // 회의·업무
  'meeting-summary': '회의록 정리',
  'daily-suggest': '일일업무 AI 제안',
  // CRM AI 런의 kind — `crm_ai_run.kind` 가 그대로 넘어온다(실측: 'ENRICH')
  ENRICH: '회사 정보 AI 보강',
  QUICK_CREATE: '붙여넣기로 등록',
  MEETING_EXTRACT: '미팅 기록 추출',
  ASSISTANT: 'CRM AI 도우미',
  'ai-budget': 'AI 예산 감시',
  'system-log-remedy': '시스템 로그 해결책',
}

export function featureLabel(feature: string | null | undefined): string {
  const f = (feature ?? '').trim()
  if (!f) return '알 수 없는 기능'
  return FEATURE_LABELS[f] ?? f
}

/** 어디서 난 일인지 — 관리자에게는 코드 이름이 아무 뜻이 없다 */
export const SOURCE_LABELS: Record<string, string> = {
  host_ai: 'AI 호출',
  crm_ai: 'CRM AI',
  crm_api: 'CRM 화면',
  host_api: '화면·API',
  ci_job: '콘텐츠 수집 작업',
  crm_job: 'CRM 자동 작업',
  cron: '정기 작업',
  client: '브라우저 화면',
}

export function sourceLabel(source: string | null | undefined): string {
  const s = (source ?? '').trim()
  return SOURCE_LABELS[s] ?? s ?? '알 수 없음'
}

/**
 * 사유를 한 마디로. **화면의 필터 이름이자 배지 글자**다.
 *
 * 이 말이 곧 관리자가 "내가 고칠 수 있는 것인가"를 가르는 첫 단서라,
 * 원인 계층으로 나눈다 — 우리 설정(config·auth) / 남의 사정(quota·server) / 일시적(network·timeout).
 */
export const REASON_LABELS: Record<string, string> = {
  quota: 'AI 사용 한도',
  auth: '키·권한',
  config: '설정 누락',
  db: '데이터베이스',
  timeout: '시간 초과',
  network: '네트워크',
  server: '외부 서비스 오류',
  bad_json: 'AI 응답 형식',
  unknown: '원인 미상',
}

export function reasonLabel(reason: string | null | undefined): string {
  const r = (reason ?? '').trim()
  return REASON_LABELS[r] ?? '원인 미상'
}
