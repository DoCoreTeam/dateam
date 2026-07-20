// 목록 심층분석 v2 — 출력 템플릿 카탈로그(코드 SSOT, 순수·타입 단언 대상).
// 템플릿 = 출력 구조 + 항목별 심화 렌즈(동일물). 각 항목을 fields로 채워 완성 문서를 조립한다.
// 큐레이션 6종은 여기(코드)에만 둔다 — DB엔 LLM생성·커스텀만(172 마이그, 드리프트 제거).
// resolve.ts가 자유지시 → keywords 매칭으로 템플릿을 고른다.

/** 항목별로 채워야 하는 필드 1개. label/description이 곧 "이 필드를 채워라"는 심화 지시. */
export interface FieldSpec {
  key: string
  label: string
  /** 이 필드에 무엇을 채우는지 — AI 프롬프트에 그대로 들어가 "막연히 상세히"를 대체한다. */
  description: string
  /** true = 비면 gap(미결 질문)으로 잡힌다. false = 있으면 좋은 보조 필드. */
  required: boolean
}

export interface AssemblySpec {
  /** table = 항목×필드 표, sections = 항목마다 소제목+필드 나열. */
  mode: 'table' | 'sections'
  /** 문서에서 항목을 부르는 명사(예: 요구사항, 리스크, 작업). */
  itemNoun: string
}

export interface TemplateSpec {
  id: string
  name: string
  description: string
  /** 자유지시 매칭 키워드(동의어 포함, 소문자). resolve.ts가 사용. */
  keywords: string[]
  fields: FieldSpec[]
  assembly: AssemblySpec
}

const f = (key: string, label: string, description: string, required = true): FieldSpec => ({
  key,
  label,
  description,
  required,
})

// ── 큐레이션 6종 ──

const REQUIREMENTS: TemplateSpec = {
  id: 'requirements',
  name: '요구사항 정의서',
  description: '각 항목을 검증 가능한 요구사항으로 상세화(수용기준·우선순위 포함).',
  keywords: ['요구사항', '요구사항정의서', '요구정의', 'srs', 'requirement', 'requirements', '정의서', '스펙', 'spec'],
  fields: [
    f('statement', '요구문', '이 항목이 요구하는 바를 "~해야 한다" 형태의 단일·검증 가능한 문장으로. 접속사(그리고)로 여러 요구를 묶지 말 것.'),
    f('rationale', '근거', '왜 이 요구가 필요한가 — 원문 근거를 인용하거나, 원문에 없으면 가정임을 명시.'),
    f('acceptance', '수용 기준', '무엇을 확인하면 이 요구가 충족됐다고 볼 수 있는지, 측정 가능한 기준으로.'),
    f('priority', '우선순위', 'must/should/could 중 하나와 그 이유.'),
    f('dependencies', '의존성', '이 요구가 전제하거나 다른 항목과 충돌·중복하는 부분(없으면 "없음").', false),
  ],
  assembly: { mode: 'sections', itemNoun: '요구사항' },
}

const RISK: TemplateSpec = {
  id: 'risk',
  name: '리스크 레지스터',
  description: '각 항목을 리스크로 보고 발생확률·영향·완화책을 정리.',
  keywords: ['리스크', '위험', '위험요소', 'risk', 'register', '레지스터', '리스크레지스터'],
  fields: [
    f('risk', '리스크', '무엇이 잘못될 수 있는가 — 구체적 사건으로.'),
    f('likelihood', '발생 확률', '높음/중간/낮음과 근거.'),
    f('impact', '영향', '발생 시 어디에 어떤 피해가 가는지.'),
    f('mitigation', '완화책', '확률·영향을 줄이는 구체 조치.'),
    f('owner', '담당', '이 리스크를 관리할 주체(원문에 없으면 "미정").', false),
  ],
  assembly: { mode: 'table', itemNoun: '리스크' },
}

const PLAN: TemplateSpec = {
  id: 'plan',
  name: '실행 계획',
  description: '각 항목을 실행 작업으로 보고 산출물·선행조건·완료기준을 상세화.',
  keywords: ['실행계획', '실행', '계획', '플랜', 'plan', '액션', 'action', '태스크', 'task', '로드맵', 'roadmap'],
  fields: [
    f('task', '작업', '무엇을 하는가 — 실행 가능한 단위 작업으로.'),
    f('deliverable', '산출물', '이 작업이 끝나면 무엇이 남는가.'),
    f('prerequisite', '선행조건', '시작 전에 필요한 것(없으면 "없음").', false),
    f('doneCriteria', '완료 기준', '무엇을 보면 이 작업이 끝났다고 판단하는가.'),
    f('effort', '예상 규모', '대략의 난이도·소요(모르면 가정임을 명시).', false),
  ],
  assembly: { mode: 'sections', itemNoun: '작업' },
}

const MEETING: TemplateSpec = {
  id: 'meeting',
  name: '회의록',
  description: '각 항목을 논의 사안으로 보고 결정·후속조치를 정리.',
  keywords: ['회의록', '회의', '미팅', 'meeting', 'minutes', '논의', '안건'],
  fields: [
    f('topic', '안건', '무엇을 논의했는가.'),
    f('discussion', '논의 내용', '핵심 논점과 오간 의견.'),
    f('decision', '결정', '무엇으로 결론 났는가(미결이면 "미결"과 사유).'),
    f('actionItem', '후속 조치', '누가 무엇을 언제까지(원문에 없으면 "미정").', false),
  ],
  assembly: { mode: 'sections', itemNoun: '안건' },
}

const COMPARE: TemplateSpec = {
  id: 'compare',
  name: '비교표',
  description: '각 항목을 비교 대상으로 보고 기준별로 정리.',
  keywords: ['비교', '비교표', 'compare', 'comparison', '대조', '벤치마크', 'benchmark', '장단점'],
  fields: [
    f('subject', '대상', '비교하는 항목 이름.'),
    f('strengths', '장점', '이 대상의 강점.'),
    f('weaknesses', '단점', '이 대상의 약점·한계.'),
    f('bestFor', '적합 상황', '어떤 경우에 이 대상이 유리한가.', false),
  ],
  assembly: { mode: 'table', itemNoun: '대상' },
}

const GENERIC: TemplateSpec = {
  id: 'generic',
  name: '범용 심층분석',
  description: '특정 템플릿이 없을 때 각 항목을 핵심·근거·시사점으로 심화.',
  keywords: ['분석', '심층', '요약', 'summary', 'analysis', '정리'],
  fields: [
    f('core', '핵심', '이 항목의 요지를 한두 문장으로.'),
    f('detail', '상세', '생략·근사된 부분을 구체화(근거 있으면 인용, 없으면 가정 명시).'),
    f('implication', '시사점', '이 항목에서 도출되는 함의나 주의점.', false),
  ],
  assembly: { mode: 'sections', itemNoun: '항목' },
}

/** 큐레이션 카탈로그(순서 = resolve 우선순위 tie-break: 앞이 우선). generic은 항상 최후 폴백. */
export const TEMPLATE_CATALOG: readonly TemplateSpec[] = [
  REQUIREMENTS,
  RISK,
  PLAN,
  MEETING,
  COMPARE,
  GENERIC,
]

export const GENERIC_TEMPLATE = GENERIC

export function getTemplateById(id: string): TemplateSpec | null {
  return TEMPLATE_CATALOG.find((t) => t.id === id) ?? null
}
