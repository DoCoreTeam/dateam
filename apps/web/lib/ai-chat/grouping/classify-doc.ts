// ① 문서 유형 판정 — 프롬프트 빌더 + 응답 파서 (순수 함수. AI 호출은 서버액션이 수행).
//
// 계약 D: 사용자 자유 지시가 전 단계를 지배한다. 지시에 유형이 명시되면 AI 판정보다 우선한다.
// docs/2026-07-20-v0.7.353-list-analysis-semantic-grouping/00-requirements.md FR-1 참조.

/** 알려진 문서 유형. 'other'는 폴백 — 유형 미상이어도 파이프라인은 계속된다. */
export const DOC_TYPES = [
  'requirements', // 요구사항정의서
  'meeting-note', // 회의록
  'risk-register', // 리스크 레지스터
  'plan', // 기획서·서비스 기획
  'roadmap', // 로드맵
  'other',
] as const
export type DocType = (typeof DOC_TYPES)[number]

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  requirements: '요구사항정의서',
  'meeting-note': '회의록',
  'risk-register': '리스크 레지스터',
  plan: '기획서',
  roadmap: '로드맵',
  other: '일반 문서',
}

/** 유형별 기본 절단 단위 설명 — cut-groups 프롬프트에 그대로 주입된다. */
export const DEFAULT_CUT_HINT: Record<DocType, string> = {
  requirements: '요구사항 1건이 1그룹',
  'meeting-note': '안건 1건이 1그룹',
  'risk-register': '리스크 1건이 1그룹',
  plan: '기능·섹션 블록이 1그룹',
  roadmap: '단계(P0/P1/…) 블록이 1그룹',
  other: '문서의 최상위 섹션이 1그룹',
}

export interface ClassifyResult {
  docType: DocType
  /** 'instruction' = 사용자 지시에서 직접 도출(AI 판정보다 우선), 'ai' = AI 판정. */
  source: 'ai' | 'instruction'
  reason: string
}

/**
 * 지시문에서 문서 유형을 직접 도출한다(결정론).
 * 사용자가 "요구사항정의서니까 …"처럼 유형을 명시하면 AI를 신뢰하지 않고 이 값을 쓴다.
 */
export function docTypeFromCommand(command: string): DocType | null {
  const c = command.trim()
  if (!c) return null
  if (/요구\s*사항|요구사항정의서|requirement/i.test(c)) return 'requirements'
  if (/회의\s*록|회의\s*노트|meeting/i.test(c)) return 'meeting-note'
  if (/리스크|위험\s*목록|risk\s*register/i.test(c)) return 'risk-register'
  if (/로드맵|roadmap/i.test(c)) return 'roadmap'
  if (/기획서|기획\s*문서/i.test(c)) return 'plan'
  return null
}

const TYPE_LIST = DOC_TYPES.map((t) => `"${t}"(${DOC_TYPE_LABEL[t]})`).join(', ')

/** 유형 판정 프롬프트. 원문 전체를 넣되 상한을 둔다(판정에는 앞부분이 결정적). */
export function buildClassifyPrompt(text: string, command: string, maxChars = 12_000): string {
  const head = text.length > maxChars ? text.slice(0, maxChars) : text
  const cmd = command.trim()
  return (
    '다음 문서가 어떤 종류인지 판정하라.\n' +
    `- 가능한 유형: ${TYPE_LIST}\n` +
    (cmd ? `- 사용자 지시(최우선 단서): ${cmd}\n` : '') +
    '- 출력은 JSON 객체만. 형식: {"docType":"<유형키>","reason":"<한 문장 근거>"}\n' +
    '- 다른 설명·마크다운을 절대 추가하지 않는다.\n\n' +
    '문서:\n"""\n' +
    head +
    '\n"""'
  )
}

function isDocType(v: unknown): v is DocType {
  return typeof v === 'string' && (DOC_TYPES as readonly string[]).includes(v)
}

/** AI 응답 파싱. 실패해도 파이프라인을 막지 않는다 — 'other'로 폴백. */
export function parseClassifyResult(parsed: Record<string, unknown> | null): ClassifyResult {
  const dt = parsed?.docType
  if (isDocType(dt)) {
    const reason = typeof parsed?.reason === 'string' ? parsed.reason : ''
    return { docType: dt, source: 'ai', reason }
  }
  return { docType: 'other', source: 'ai', reason: 'AI 판정 실패 — 일반 문서로 처리' }
}
