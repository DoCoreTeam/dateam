// lib/ci/ai/creative.ts — "무엇이 통했나" 분석 (순수 함수)
//
// 잘 나간 콘텐츠에서 뽑는 것:
//  - 썸네일에 박힌 문구와 구성
//  - 제목·도입부의 후킹 메시지와 그 유형
//
// 관측 가능한 것만 뽑는다. 보이지 않는 것을 추측해 채우지 않는다.

export interface CreativeAnalysis {
  thumbnailText: string | null
  thumbnailStyle: string[]
  thumbnailSummary: string | null
  hookMessage: string | null
  hookType: string | null
  titlePattern: string[]
}

export const EMPTY_CREATIVE: CreativeAnalysis = {
  thumbnailText: null, thumbnailStyle: [], thumbnailSummary: null,
  hookMessage: null, hookType: null, titlePattern: [],
}

/** 후킹 유형 — 화면과 프롬프트가 같은 목록을 쓴다. */
export const HOOK_TYPES = [
  '질문형', '숫자형', '반전', '이득제시', '공포·경고', '권위·증명',
  '공감·고백', '비교', '긴급·마감', '호기심공백',
] as const

export const THUMBNAIL_STYLES = [
  '인물 클로즈업', '큰 글자', '화살표·동그라미 강조', '고대비 색',
  '전후 비교', '숫자 강조', '자막 캡처', '제품 단독', '텍스트 없음',
] as const

/**
 * 제목에서 규칙만으로 뽑아낼 수 있는 패턴.
 * AI를 부르지 않아도 이 정도는 나온다 — 키가 없어도 기능이 죽지 않는다.
 */
export function detectTitlePatterns(title: string | null): string[] {
  if (!title) return []
  const t = title.trim()
  const out: string[] = []
  if (/\d/.test(t)) out.push('숫자 포함')
  if (/[?？]/.test(t)) out.push('의문형')
  if (/[[\](){}【】]/.test(t)) out.push('괄호 부제')
  if (/[!！]/.test(t)) out.push('감탄')
  if (t.length <= 20) out.push('짧은 제목')
  if (t.length >= 45) out.push('긴 제목')
  if (/\.{3}|…/.test(t)) out.push('말줄임 여운')
  if (/(방법|비법|꿀팁|이유|차이|후기|리뷰)/.test(t)) out.push('정보형 키워드')
  return out
}

/** 규칙만으로 후킹 유형을 추정한다. AI 결과가 있으면 그쪽을 우선한다. */
export function guessHookType(title: string | null): string | null {
  if (!title) return null
  const t = title.trim()
  if (/[?？]/.test(t)) return '질문형'
  if (/^\d|\d+(가지|개|초|분|일|년)/.test(t)) return '숫자형'
  if (/(사실|알고보니|반전|충격|의외)/.test(t)) return '반전'
  if (/(하지마|절대|주의|위험|실수)/.test(t)) return '공포·경고'
  if (/(꿀팁|비법|방법|하는 법)/.test(t)) return '이득제시'
  if (/(vs|비교|차이)/i.test(t)) return '비교'
  return null
}

export function buildCreativePrompt(input: {
  title: string | null
  caption: string | null
  hasThumbnail: boolean
}): string {
  return [
    '아래 콘텐츠가 왜 잘 됐는지, 눈에 보이는 요소만 분석해 주세요.',
    input.hasThumbnail
      ? '함께 주는 이미지는 이 콘텐츠의 썸네일입니다. 썸네일에 적힌 글자를 그대로 읽어 주세요.'
      : '썸네일 이미지는 제공되지 않았습니다. 썸네일 관련 항목은 null로 두세요.',
    '',
    `제목: ${input.title ?? '(없음)'}`,
    `설명: ${(input.caption ?? '(없음)').slice(0, 500)}`,
    '',
    '아래 JSON만 출력하세요. 설명이나 코드펜스를 넣지 마세요.',
    '{',
    '  "thumbnailText": "썸네일에 적힌 문구 그대로. 글자가 없으면 null",',
    `  "thumbnailStyle": ["${THUMBNAIL_STYLES.slice(0, 4).join('", "')}" 중 해당하는 것들],`,
    '  "thumbnailSummary": "썸네일이 무엇을 보여주는지 한 문장",',
    '  "hookMessage": "가장 강한 후킹 문장 (제목이나 설명에서 그대로 인용)",',
    `  "hookType": "${HOOK_TYPES.join('|')} 중 하나",`,
    '  "titlePattern": ["제목의 특징들"]',
    '}',
    '',
    '보이지 않는 것을 추측하지 마세요. 모르면 null이나 빈 배열로 두세요.',
    '조회수나 성과 수치를 지어내지 마세요.',
  ].join('\n')
}

function asStrings(v: unknown, allow?: readonly string[]): string[] {
  if (!Array.isArray(v)) return []
  const list = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((s) => s.trim())
  return allow ? list.filter((s) => allow.includes(s)) : list.slice(0, 6)
}

function asText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t || t === 'null' || t === 'N/A') return null
  return t.slice(0, 500)
}

/**
 * AI 응답 파싱. 형식이 깨지면 null —
 * 반쯤 깨진 분석을 저장해 사용자가 잘못된 근거로 기획하게 만들지 않는다.
 */
export function parseCreative(raw: string, fallbackTitle: string | null): CreativeAnalysis | null {
  const m = /\{[\s\S]*\}/.exec(raw)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>
    const hookType = asText(j.hookType)
    const result: CreativeAnalysis = {
      thumbnailText: asText(j.thumbnailText),
      thumbnailStyle: asStrings(j.thumbnailStyle),
      thumbnailSummary: asText(j.thumbnailSummary),
      hookMessage: asText(j.hookMessage),
      hookType: hookType && (HOOK_TYPES as readonly string[]).includes(hookType)
        ? hookType
        : guessHookType(fallbackTitle),
      titlePattern: asStrings(j.titlePattern).length > 0
        ? asStrings(j.titlePattern)
        : detectTitlePatterns(fallbackTitle),
    }
    const empty = !result.thumbnailText && !result.thumbnailSummary
      && !result.hookMessage && result.titlePattern.length === 0
    return empty ? null : result
  } catch {
    return null
  }
}

/** AI 없이 규칙만으로 만드는 최소 분석. 키가 없어도 화면이 비지 않는다. */
export function creativeFromRules(title: string | null): CreativeAnalysis {
  return {
    ...EMPTY_CREATIVE,
    hookMessage: title,
    hookType: guessHookType(title),
    titlePattern: detectTitlePatterns(title),
  }
}
